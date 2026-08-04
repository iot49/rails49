import { describe, expect, it } from 'vitest';
import { rankAUC, runBenchmark, formatReport } from '../src/harness.ts';
import { buildCases } from '../src/cases.ts';
import { makeImage } from '../src/image.ts';
import { madScorer } from '../src/baseline.ts';
import type { BenchCase } from '../src/cases.ts';

describe('rankAUC', () => {
  it('is 1 for perfectly separated scores', () => {
    expect(rankAUC([0.1, 0.2], [0.5, 0.9])).toBe(1);
  });

  it('is 0.5 for identical distributions', () => {
    expect(rankAUC([0.3, 0.3], [0.3, 0.3])).toBe(0.5);
  });

  it('is 0 when flags score below passes', () => {
    expect(rankAUC([0.5, 0.9], [0.1, 0.2])).toBe(0);
  });
});

function syntheticCase(grade: string, expect_: 'pass' | 'flag', value: number): BenchCase {
  return {
    archive: 'a.r49',
    source: 'img.jpg',
    grade,
    expect: expect_,
    frame: makeImage(4, 4, value),
    refs: [makeImage(4, 4, 0)],
  };
}

describe('runBenchmark', () => {
  it('separates constructed pass and flag cases and thresholds at zero false alarms', async () => {
    // mad against an all-zero ref scores exactly the fill value
    const cases = [
      syntheticCase('pass:sibling', 'pass', 0.1),
      syntheticCase('pass:sibling', 'pass', 0.2),
      syntheticCase('flag:big', 'flag', 0.8),
      syntheticCase('flag:small', 'flag', 0.15),
    ];
    const report = await runBenchmark(madScorer, cases);
    expect(report.zeroFAThreshold).toBeCloseTo(0.2, 6);
    const big = report.grades.find((g) => g.grade === 'flag:big')!;
    const small = report.grades.find((g) => g.grade === 'flag:small')!;
    expect(big.detectionAtZeroFA).toBe(1);
    expect(small.detectionAtZeroFA).toBe(0);
    expect(report.overallAUC).toBeCloseTo(0.75, 6);
  });

  it('rejects non-finite scores', async () => {
    const nanScorer = { name: 'nan', score: () => NaN };
    await expect(runBenchmark(nanScorer, [syntheticCase('pass:sibling', 'pass', 0)])).rejects.toThrow(
      /non-finite/,
    );
  });

  it('runs the full pipeline on synthetic archives and reports every grade', async () => {
    const img = (seed: number) => {
      const im = makeImage(96, 96);
      let s = seed;
      for (let i = 0; i < im.data.length; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        im.data[i] = (s >>> 8) / 2 ** 24;
      }
      return im;
    };
    const cases = buildCases([
      {
        name: 'synthetic.r49',
        images: [
          { filename: 'a.jpg', image: img(1) },
          { filename: 'b.jpg', image: img(2) },
        ],
      },
    ]);
    const report = await runBenchmark(madScorer, cases);
    expect(report.cases).toBe(cases.length);
    expect(report.grades.map((g) => g.grade)).toContain('flag:translate-20px');
    const rendered = formatReport(report);
    expect(rendered).toContain('overall AUC');
    expect(rendered).toContain('flag:combo');
  });
});
