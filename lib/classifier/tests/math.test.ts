import { describe, it, expect } from 'vitest';
// Internal base class — not part of the package interface, imported directly.
import { BaseClassifier } from '../src/base.ts';

class TestClassifier extends BaseClassifier {
  async load() {}
  async classify() { return []; }
  
  public testScalingMath(point: {x: number, y: number}, img_dpt: number) {
    return this.getScalingMath(point, img_dpt);
  }
}

describe('BaseClassifier', () => {
  it('calculates DPT correctly', () => {
    const manifest = {
      layout: {
        calibration: {
          p0: { x: 0, y: 0 },
          p1: { x: 100, y: 0 },
          size_mm: 100
        },
        scale: 'N'
      }
    };
    // Gauge for N is 8.96875mm. 100 pixels / 100 mm = 1 px/mm. 1 px/mm * 8.96875mm = 8.96875 DPT.
    expect(BaseClassifier.calculateDpt(manifest)).toBeCloseTo(8.96875);
  });

  it('calculates scaling math correctly', () => {
    const config = {
      dpt: 30,
      crop_size: 96,
      labels: ['coupling', 'other', 'track', 'train'],
      mean: [0.485, 0.456, 0.406],
      std: [0.229, 0.224, 0.225]
    };
    const classifier = new TestClassifier(config);
    
    // Image is 60 DPT, so we need to crop twice as many pixels to get the same "real world" area.
    const result = classifier.testScalingMath({ x: 500, y: 500 }, 60);
    
    expect(result.cropSize).toBe(96);
    expect(result.srcSize).toBe(192); // 96 * (60/30)
    expect(result.sx).toBe(500 - 192/2);
    expect(result.sy).toBe(500 - 192/2);
  });
});
