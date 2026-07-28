import * as ort from 'onnxruntime-web';
import { type Point } from '@occupancy/r49';
import { BaseClassifier, type ClassifierConfig } from './base.ts';

// Ensure WASM paths are set (this can be overridden by the app)
ort.env.wasm.wasmPaths = '/ort/';

export class BrowserClassifier extends BaseClassifier {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;

  constructor(config: ClassifierConfig) {
    super(config);
    this._canvas = document.createElement('canvas');
    this._canvas.width = config.crop_size;
    this._canvas.height = config.crop_size;
    const ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Failed to create classification canvas context');
    this._ctx = ctx;
  }

  async load(source: string | Blob | ArrayBuffer) {
    try {
      let modelData: string | Uint8Array;
      if (source instanceof Blob) {
        modelData = new Uint8Array(await source.arrayBuffer());
      } else if (source instanceof ArrayBuffer) {
        modelData = new Uint8Array(source);
      } else {
        modelData = source;
      }

      const options: ort.InferenceSession.SessionOptions = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      };

      this._session = await ort.InferenceSession.create(modelData as any, options);
      console.log('ONNX browser session loaded successfully');
    } catch (err) {
      console.error('Failed to load ONNX model in browser', err);
      throw err;
    }
  }

  async classify(
    image: CanvasImageSource,
    point: Point,
    img_dpt: number
  ): Promise<string[]> {
    if (!this._session) return [];

    const { sx, sy, srcSize, cropSize } = this.getScalingMath(point, img_dpt);

    // Extract patch using Canvas
    this._ctx.clearRect(0, 0, cropSize, cropSize);
    this._ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, cropSize, cropSize);

    // Browser ImageData is RGBA, so we need to convert it to RGB for the shared preprocessor
    const imageData = this._ctx.getImageData(0, 0, cropSize, cropSize);
    const { data } = imageData;
    const rgbData = new Uint8Array(cropSize * cropSize * 3);
    for (let i = 0; i < cropSize * cropSize; i++) {
      rgbData[i * 3] = data[i * 4];
      rgbData[i * 3 + 1] = data[i * 4 + 1];
      rgbData[i * 3 + 2] = data[i * 4 + 2];
    }

    const inputTensor = this.preprocessToTensor(
      rgbData,
      cropSize,
      (data, dims) => new ort.Tensor('float32', data, dims)
    );

    const feeds = { [this._session.inputNames[0]]: inputTensor };
    const results = await this._session.run(feeds);
    const output = results[this._session.outputNames[0]];
    
    return this.getLabelsFromResult(output.data as Float32Array);
  }
}
