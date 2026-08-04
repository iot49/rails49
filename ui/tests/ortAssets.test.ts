import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {
  CLOUDFLARE_MAX_FILE_BYTES,
  ORT_WASM_BINARY,
  ORT_WASM_GLUE,
  ortCopyTargets,
} from '../ortAssets.js';
import { DETECTOR_MODEL_URL } from '../modelAssets.js';

// The deployed site must be crossOriginIsolated for ORT to use more than one
// WASM thread (#15), and COEP: require-corp is only safe once every subresource
// is same-origin. That makes "which .wasm ships from origin" a deployment
// invariant rather than a build detail: the jsep build is 25.02 MiB, just over
// Cloudflare Pages' per-file ceiling, which is what pushed it onto a CDN in the
// first place. These tests pin the choice that lets it come home.

const require = createRequire(import.meta.url);
const ortDist = path.dirname(require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'));
const repoRoot = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

/**
 * Every module that imports ORT. They must agree about all of this.
 *
 * The classifier is on the list although nothing loads it any more (#7, #85):
 * it stays retrainable and revivable, and a revival that came back on the
 * package root would pull the oversized jsep binary into a bundle that had
 * stopped checking.
 */
const ORT_IMPORTERS = [
  'lib/classifier/src/browser.ts',
  'lib/detector/src/browser.ts',
  'ui/src/rr-live-view.ts',
];

/** Every `ort-wasm-simd-threaded*.wasm` an ORT dist file names, following glue modules. */
function referencedWasm(entry: string, seen = new Set<string>()): Set<string> {
  const found = new Set<string>();
  if (seen.has(entry)) return found;
  seen.add(entry);
  const source = fs.readFileSync(path.join(ortDist, entry), 'utf8');
  for (const ref of source.match(/ort-wasm-simd-threaded[\w.]*\.(?:wasm|mjs)/g) ?? []) {
    if (ref.endsWith('.wasm')) found.add(ref);
    else for (const nested of referencedWasm(ref, seen)) found.add(nested);
  }
  return found;
}

describe('ORT wasm assets', () => {
  it('ships a binary under Cloudflare Pages\' per-file limit', () => {
    const { size } = fs.statSync(path.join(ortDist, ORT_WASM_BINARY));
    expect(size).toBeLessThan(CLOUDFLARE_MAX_FILE_BYTES);
  });

  it('copies the binary, its glue, and nothing else', () => {
    // Named, never globbed: `*.wasm` sweeps the jsep build back in and
    // `*.{mjs,js}` drags 44 MB of webgl/webgpu/node builds nothing can fetch.
    expect(ortCopyTargets).toEqual([
      { src: `node_modules/onnxruntime-web/dist/${ORT_WASM_BINARY}`, dest: 'ort' },
      { src: `node_modules/onnxruntime-web/dist/${ORT_WASM_GLUE}`, dest: 'ort' },
    ]);
    for (const file of [ORT_WASM_BINARY, ORT_WASM_GLUE]) {
      expect(fs.existsSync(path.join(ortDist, file)), file).toBe(true);
    }
  });

  it('names the glue ORT actually resolves against wasmPaths', () => {
    // ORT loads the glue from `wasmPaths` the same way it loads the binary, so
    // a copy target missing it 404s on a path no build step would flag.
    const source = fs.readFileSync(path.join(ortDist, 'ort.wasm.bundle.min.mjs'), 'utf8');
    expect(source).toContain(ORT_WASM_GLUE);
  });

  it('is the only wasm the WASM-EP entry point asks for', () => {
    // 'onnxruntime-web/wasm' resolves to ort.wasm.bundle.min.mjs under a
    // bundler; the plain `onnxruntime-web` entry would pull the oversized jsep
    // build instead. Checking every wasm-only variant keeps a condition change
    // from quietly swapping the answer.
    for (const entry of ['ort.wasm.bundle.min.mjs', 'ort.wasm.min.mjs', 'ort.wasm.min.js']) {
      expect([...referencedWasm(entry)], entry).toEqual([ORT_WASM_BINARY]);
    }
  });

  it('is reached through the WASM-EP entry point everywhere ORT is imported', () => {
    // Both files must name the same specifier: two specifiers are two module
    // instances, and the `ort.env.wasm` the live view configures would not be
    // the one the classifier's session reads.
    for (const file of ORT_IMPORTERS) {
      expect(read(file), file).toMatch(/from ['"]onnxruntime-web\/wasm['"]/);
      expect(read(file), file).not.toMatch(/from ['"]onnxruntime-web['"]/);
    }
  });

  it('is served from origin, at the path the copy targets write to', () => {
    // ORT otherwise resolves the binary from a `new URL(…, import.meta.url)`
    // copy Rollup emits beside the chunk, which `dropUnfetchableOrtWasm`
    // deletes — so this assignment is what makes deleting it safe, and it has
    // to name `ort/` under the configured base. A CDN would fail COEP anyway.
    const source = read('ui/src/rr-live-view.ts');
    expect(source).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(source).toMatch(/ort\.env\.wasm\.wasmPaths\s*=\s*'\/ui\/ort\/'/);
    expect(ortCopyTargets.every(t => t.dest === 'ort')).toBe(true);
  });

  it('is named identically by the deploy script, which cannot import it', () => {
    expect(read('bin/deploy.sh')).toContain(ORT_WASM_BINARY);
  });

  it('refuses to load a model before something says where the runtime is', async () => {
    // The library has no correct default — `/ort/` is a 404 under this app's
    // `/ui/` base — and the emitted fallback is gone, so an unset wasmPaths
    // would 404 on a hashed filename. Fail where the cause is legible instead.
    //
    // Asserted against the detector rather than the classifier because the
    // detector is what the live view loads: this is the shipped path, and the
    // guard is only worth anything on the path that runs.
    const ort = await import('onnxruntime-web/wasm');
    const { loadDetector } = await import('@occupancy/detector/browser');
    const previous = ort.env.wasm.wasmPaths;
    ort.env.wasm.wasmPaths = undefined;
    try {
      await expect(loadDetector(DETECTOR_MODEL_URL)).rejects.toThrow(/wasmPaths/);
    } finally {
      ort.env.wasm.wasmPaths = previous;
    }
  });
});

describe('rails49.org/_headers', () => {
  const headers = fs.readFileSync(path.join(repoRoot, 'rails49.org/_headers'), 'utf8');

  it('cross-origin isolates the app', () => {
    const rule = headers.split(/\n(?=\S)/).find(block => block.startsWith('/ui/'));
    expect(rule).toBeDefined();
    expect(rule).toMatch(/^\s+Cross-Origin-Opener-Policy:\s*same-origin$/m);
    expect(rule).toMatch(/^\s+Cross-Origin-Embedder-Policy:\s*require-corp$/m);
  });

  it('leaves the landing page alone', () => {
    // rails49.org/index.html loads Google Fonts cross-origin; require-corp on
    // `/*` would block them, and the landing page needs no isolation.
    expect(headers).not.toMatch(/^\/\*\s*$/m);
  });
});
