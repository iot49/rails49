declare const ort: any;

import { createContext } from "@lit/context";
import type { Point } from './manifest';

export type ModelPrecision = 'fp32' | 'fp16' | 'int8';

interface ClassifierConfig {
  labels: string[];
  dpt: number;
  cropSize: number;
}

export class Classifier {
  private _session: any = null;
  private _config: ClassifierConfig | null = null;
  private _initPromise: Promise<void> | null = null;
  private _queue: Promise<any> = Promise.resolve();
  
  readonly model: string;
  readonly precision: ModelPrecision;

  constructor(modelName: string, precision: ModelPrecision = 'fp32') {
    this.model = modelName;
    this.precision = precision;
  }

  /**
   * Ensures the model configuration and session are loaded.
   * Can be called explicitly for pre-loading, but is handled lazily by classify() and patch().
   */
  async initialize(modelData?: Uint8Array): Promise<void> {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInitialize(modelData);
    return this._initPromise;
  }

  private async _doInitialize(modelData?: Uint8Array): Promise<void> {
    const baseUrl = `models/${this.model}`;
    
    // 1. Load configuration
    try {
        const response = await fetch(`${baseUrl}/model.config`);
        if (!response.ok) {
            throw new Error(`Failed to load model config for ${this.model}: ${response.statusText}`);
        }
        const configData = await response.json();
        
        this._config = {
            labels: configData.labels || ["track", "train", "other"],
            dpt: configData.dpt || 28,
            cropSize: configData.crop_size || configData.size || 96
        };
    } catch (e) {
        console.error(`[Classifier] Config Load Failed:`, e);
        throw e;
    }

    // 2. Initialize ONNX runtime session
    try {
        let input: any = modelData;
        if (!input) {
            const modelUrl = `${baseUrl}/model_${this.precision}.ort`;
            const response = await fetch(modelUrl);
            if (!response.ok) {
                throw new Error(`Failed to load model binary from ${modelUrl}: ${response.statusText}`);
            }
            input = new Uint8Array(await response.arrayBuffer());
        }

        const options: any = {
            executionProviders: ['wasm', 'cpu'],
            graphOptimizationLevel: 'all'
        };

        this._session = await ort.InferenceSession.create(input, options);
        console.log(`[Classifier] ${this.model} (${this.precision}) loaded successfully.`);
    } catch (e) {
        console.error(`[Classifier] Session Init Failed:`, e);
        throw e;
    }
  }

  /**
   * Internal helper to ensure initialization before any public action.
   */
  private async _ensureInitialized() {
    await this.initialize();
    if (!this._session || !this._config) {
        throw new Error("Classifier failed to initialize");
    }
  }

  /**
   * Classifies a marker in the given image.
   * 
   * @param image Source image
   * @param center Coordinates of the marker
   * @param img_dpt Dots-per-track of the source image
   */
  async classify(image: ImageBitmap, center: Point, img_dpt: number): Promise<string> {
    const result = this._queue.then(async () => {
        await this._ensureInitialized();
        return await this._doClassify(image, center, img_dpt);
    });

    // Update queue but don't block current call
    this._queue = result.catch(() => {}); 
    
    return result;
  }

  /**
   * Extracts a square patch from the source image, centered at `center`.
   * The patch is scaled such that the resulting features match the model's DPT.
   * 
   * @param image Source image
   * @param center Center point in source coordinates
   * @param img_dpt Dots-per-track of the source image
   */
  async patch(image: CanvasImageSource, center: Point, img_dpt: number): Promise<HTMLCanvasElement | null> {
    await this._ensureInitialized();

    const scaleFactor = this._config!.dpt / img_dpt; 
    const dstSize = this._config!.cropSize;
    const srcSize = dstSize / scaleFactor;
    
    const sx = center.x - srcSize / 2;
    const sy = center.y - srcSize / 2;

    const canvas = document.createElement('canvas');
    canvas.width = dstSize;
    canvas.height = dstSize;
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Background color (if patch goes out of bounds)
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, dstSize, dstSize);

    try {
        ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, dstSize, dstSize);
    } catch (e) {
        console.error("[Classifier] Failed to draw image patch", e);
        return null;
    }
    
    return canvas;
  }

  private async _doClassify(image: ImageBitmap, center: Point, img_dpt: number): Promise<string> {
    // 1. Extract patch (reusing our own public patch logic internally)
    const patchCanvas = await this.patch(image, center, img_dpt);
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

    return this._config!.labels[maxIdx] || 'unknown';
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