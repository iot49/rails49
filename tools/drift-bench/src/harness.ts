import { GrayImage } from './image.ts';
import { BenchCase } from './cases.ts';

/**
 * A drift-scoring candidate. Higher score = more structural disagreement
 * between the frame and the reference images. The score must be continuous —
 * thresholding is the harness's job (and eventually the shipped check's),
 * never the scorer's.
 */
export interface Scorer {
  name: string;
  score(frame: GrayImage, refs: GrayImage[]): number | Promise<number>;
}

export interface GradeStats {
  grade: string;
  expect: 'pass' | 'flag';
  n: number;
  min: number;
  median: number;
  max: number;
  /** AUC of this grade's scores against ALL pass scores (flag grades only). */
  auc: number | null;
  /** Fraction flagged at the zero-false-alarm threshold (flag grades only). */
  detectionAtZeroFA: number | null;
}

export interface BenchReport {
  scorer: string;
  cases: number;
  /** strictly above every pass score: the loudest usable threshold */
  zeroFAThreshold: number;
  /** AUC of all flag scores vs all pass scores */
  overallAUC: number;
  grades: GradeStats[];
  /** per-case rows for downstream analysis */
  rows: { archive: string; source: string; grade: string; expect: 'pass' | 'flag'; score: number }[];
}

/** Mann-Whitney AUC: P(flag score > pass score), ties counted half. */
export function rankAUC(passScores: number[], flagScores: number[]): number {
  if (passScores.length === 0 || flagScores.length === 0) return NaN;
  let wins = 0;
  for (const f of flagScores) {
    for (const p of passScores) {
      if (f > p) wins += 1;
      else if (f === p) wins += 0.5;
    }
  }
  return wins / (passScores.length * flagScores.length);
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function runBenchmark(scorer: Scorer, cases: BenchCase[]): Promise<BenchReport> {
  const rows: BenchReport['rows'] = [];
  for (const c of cases) {
    const score = await scorer.score(c.frame, c.refs);
    if (!Number.isFinite(score)) {
      throw new Error(`${scorer.name} returned a non-finite score on ${c.archive}/${c.source} (${c.grade})`);
    }
    rows.push({ archive: c.archive, source: c.source, grade: c.grade, expect: c.expect, score });
  }

  const passScores = rows.filter((r) => r.expect === 'pass').map((r) => r.score);
  const flagScores = rows.filter((r) => r.expect === 'flag').map((r) => r.score);
  const zeroFAThreshold = Math.max(...passScores);

  const grades: GradeStats[] = [];
  for (const grade of [...new Set(rows.map((r) => r.grade))]) {
    const scores = rows.filter((r) => r.grade === grade).map((r) => r.score);
    const sorted = [...scores].sort((a, b) => a - b);
    const expect = rows.find((r) => r.grade === grade)!.expect;
    grades.push({
      grade,
      expect,
      n: scores.length,
      min: sorted[0],
      median: median(sorted),
      max: sorted[sorted.length - 1],
      auc: expect === 'flag' ? rankAUC(passScores, scores) : null,
      detectionAtZeroFA:
        expect === 'flag' ? scores.filter((s) => s > zeroFAThreshold).length / scores.length : null,
    });
  }

  return {
    scorer: scorer.name,
    cases: rows.length,
    zeroFAThreshold,
    overallAUC: rankAUC(passScores, flagScores),
    grades,
    rows,
  };
}

export function formatReport(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(`scorer: ${report.scorer}   cases: ${report.cases}`);
  lines.push(
    `overall AUC (flag vs pass): ${report.overallAUC.toFixed(3)}   zero-false-alarm threshold: ${report.zeroFAThreshold.toFixed(5)}`,
  );
  lines.push('');
  const header = ['grade', 'n', 'min', 'median', 'max', 'AUC', 'det@0FA'];
  const rows = report.grades.map((g) => [
    g.grade,
    String(g.n),
    g.min.toFixed(5),
    g.median.toFixed(5),
    g.max.toFixed(5),
    g.auc === null ? '—' : g.auc.toFixed(3),
    g.detectionAtZeroFA === null ? '—' : (g.detectionAtZeroFA * 100).toFixed(0) + '%',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (cells: string[]) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  lines.push(fmt(header));
  for (const r of rows) lines.push(fmt(r));
  return lines.join('\n');
}
