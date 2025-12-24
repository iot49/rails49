declare const ort: any;

import { createContext } from "@lit/context";
import type { Point } from './manifest';

/* Types from classifier_spec.ts */

export interface ClassifierSpecData {
  model: string;
  precision: 'fp32' | 'fp16' | 'int8';
  labels: string[];
  dpt: number;
  crop_size: number;
}

export interface ModelConfig {
  model?: string;
  labels: string[];
  size?: number;
  crop_size?: number; 
  dpt?: number;
  [key: string]: any;
}

export class ClassifierSpec {
  private _data: ClassifierSpecData;

  constructor(data: ClassifierSpecData) {
    this._data = data;
  }

  static async load(modelName: string, precision: 'fp32' | 'fp16' | 'int8' = 'fp32'): Promise<ClassifierSpec> {
    const baseUrl = `models/${modelName}`;
    const response = await fetch(`${baseUrl}/model.config`);
    
    if (!response.ok) {
        console.warn(`Failed to load model config for ${modelName}: ${response.statusText}. Using defaults.`);
        return new ClassifierSpec({
            model: modelName,
            precision: precision,
             labels: ["track", "train", "other"],
             dpt: 28,
             crop_size: 96
        });
    }

    const config: ModelConfig = await response.json();

    const data: ClassifierSpecData = {
      model: modelName,
      precision: precision,
      labels: config.labels || ["track", "train", "other"],
      dpt: config.dpt || 28,
      // Handle legacy 'size', 'crop_size', 'image_size' etc (currently 'size' in config.json)
      crop_size: config.crop_size || config.size || 96
    };

    return new ClassifierSpec(data);
  }

  get model(): string { return this._data.model; }
  get precision(): 'fp32' | 'fp16' | 'int8' { return this._data.precision; }
  get labels(): string[] { return this._data.labels; }
  get dpt(): number { return this._data.dpt; }
  get crop_size(): number { return this._data.crop_size; }
  get data(): ClassifierSpecData { return this._data; }

  /**
   * Returns the path to the model file relative to the public directory.
   */
  get model_path(): string {
     return `models/${this.model}/model_${this.precision}.ort`; 
  }
}

export class Classifier {
  private _spec: ClassifierSpec;
  private _session: any = null;
  private _queue: Promise<any> = Promise.resolve();
  
  constructor(spec: ClassifierSpec) {
    this._spec = spec;
  }

  get spec(): ClassifierSpec { return this._spec; }

  async initialize(modelData?: Uint8Array): Promise<void> {
    if (this._session) return;

    try {
        const input = modelData || this.spec.model_path;
        if (typeof input === 'string') {
            console.log(`Loading model from ${input}`);
        } else {
            console.log(`Loading model from buffer (${input.byteLength} bytes)`);
        }
        
        const options: any = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        };

        this._session = await ort.InferenceSession.create(input as any, options);
        console.log(`Model loaded successfully.`);
    } catch (e) {
        console.error("Failed to initialize classifier session", e);
        throw e;
    }
  }

  async classify(image: ImageBitmap, center: Point, img_dpt: number): Promise<string> {
    // Wrap the entire classification in the queue
    const result = this._queue.then(async () => {
        if (!this._session) {
            await this.initialize();
        }
        return await this._doClassify(image, center, img_dpt);
    });

    // Update queue but don't block current call
    this._queue = result.catch(() => {}); 
    
    return result;
  }

  private async _doClassify(image: ImageBitmap, center: Point, img_dpt: number): Promise<string> {
    // 1. Extract patch
    // Calculate scale factor to match model's expected DPT
    const scaleFactor = this.spec.dpt / img_dpt; 
    const patchCanvas = this.patch(image, center, this.spec.crop_size, scaleFactor);
    
    if (!patchCanvas) {
        throw new Error("Failed to extract patch");
    }

    // 2. Preprocess
    const tensor = await this._preprocess(patchCanvas);

    // 3. Inference
    const feeds: Record<string, any> = {};
    const inputNames = this._session!.inputNames;
    feeds[inputNames[0]] = tensor;

    const results = await this._session!.run(feeds);
    const outputNames = this._session!.outputNames;
    const output = results[outputNames[0]];

    // 4. Postprocess (Argmax)
    const probs = output.data;
    let maxIdx = 0;
    let maxProb = -Infinity;
    
    for (let i = 0; i < probs.length; i++) {
        const val = Number(probs[i]);
        if (val > maxProb) {
            maxProb = val;
            maxIdx = i;
        }
    }

    return this.spec.labels[maxIdx] || 'unknown';
  }

  /**
   * Extracts a square patch from the source image, centered at `center`.
   * The patch is scaled such that the resulting features match the model's DPT.
   * 
   * @param image Source image (ImageBitmap preferred)
   * @param center Center point in source coordinates
   * @param dst_size Destination size (width/height) in pixels (e.g. 96)
   * @param scale_factor Scaling factor (target_dpt / source_dpt)
   */
  patch(image: CanvasImageSource, center: Point, dst_size: number, scale_factor: number): HTMLCanvasElement | null {
    // Determine the size of the area to crop from the source image
    // If we want dst_size pixels at scale S, we need dst_size / S pixels from source
    const srcSize = dst_size / scale_factor;
    
    const sx = center.x - srcSize / 2;
    const sy = center.y - srcSize / 2;

    const canvas = document.createElement('canvas');
    canvas.width = dst_size;
    canvas.height = dst_size;
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Background color (if patch goes out of bounds)
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, dst_size, dst_size);

    try {
        ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, dst_size, dst_size);
    } catch (e) {
        console.error("Failed to draw image patch", e);
        return null;
    }
    
    return canvas;
  }

  private async _preprocess(canvas: HTMLCanvasElement): Promise<any> {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("No context");
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;
      
      // Standard ImageNet normalization
      const mean = [0.485, 0.456, 0.406];
      const std = [0.229, 0.224, 0.225];

      const float32Data = new Float32Array(3 * width * height);
      
      for (let i = 0; i < width * height; i++) {
           const r = data[i * 4] / 255.0;
           const g = data[i * 4 + 1] / 255.0;
           const b = data[i * 4 + 2] / 255.0;
           
           // Channel 0 (R)
           float32Data[i] = (r - mean[0]) / std[0];
           // Channel 1 (G)
           float32Data[width * height + i] = (g - mean[1]) / std[1];
           // Channel 2 (B)
           float32Data[2 * width * height + i] = (b - mean[2]) / std[2];
      }

      return new ort.Tensor('float32', float32Data, [1, 3, height, width]);
  }
}

export const classifierContext = createContext<Classifier | undefined>('classifier');