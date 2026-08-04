import { parseArgs } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { loadArchives } from './load.ts';
import { buildCases } from './cases.ts';
import { runBenchmark, formatReport } from './harness.ts';
import { BASELINE_SCORERS } from './baseline.ts';

/**
 * Synthetic camera-drift benchmark over the iot49/r49 fixture archives.
 *
 *   pnpm --filter @occupancy/drift-bench bench
 *   pnpm --filter @occupancy/drift-bench bench -- --scorer zmad --json out.json
 *
 * The fixtures default to a sibling clone of iot49/r49; point --fixtures
 * anywhere else that holds .r49 archives.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const { values } = parseArgs({
  // pnpm forwards the `--` separator itself; parseArgs must not see it
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    fixtures: { type: 'string', default: join(repoRoot, '..', 'r49', 'fixtures') },
    scorer: { type: 'string', default: 'mad' },
    archive: { type: 'string' },
    json: { type: 'string' },
  },
});

const scorer = BASELINE_SCORERS[values.scorer!];
if (!scorer) {
  console.error(`unknown scorer "${values.scorer}" — built in: ${Object.keys(BASELINE_SCORERS).join(', ')}`);
  process.exit(1);
}

let archives;
try {
  archives = await loadArchives(values.fixtures!);
} catch (err) {
  console.error(String(err));
  console.error(`\nThe fixtures live in the iot49/r49 repo. Clone it beside this one:`);
  console.error(`  gh repo clone iot49/r49 "${join(repoRoot, '..', 'r49')}" -- --depth 1`);
  process.exit(1);
}
if (values.archive) {
  archives = archives.filter((a) => a.name.includes(values.archive!));
}

const cases = buildCases(archives);
console.error(
  `${archives.length} archives, ${archives.reduce((n, a) => n + a.images.length, 0)} images, ${cases.length} cases`,
);

const report = await runBenchmark(scorer, cases);
console.log(formatReport(report));

if (values.json) {
  await writeFile(values.json, JSON.stringify(report, null, 2));
  console.error(`\nwrote ${values.json}`);
}
