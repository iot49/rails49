/**
 * Which ONNX Runtime WASM binary the bundle ships, in one place.
 *
 * ORT publishes four `ort-wasm-simd-threaded*.wasm` builds. Only the jsep one
 * (WebGPU/WebNN) exceeds Cloudflare Pages' 25 MiB per-file limit — 25.02 MiB,
 * over by 0.02 — and it is the one the default `onnxruntime-web` entry point
 * asks for. The app requests `executionProviders: ['wasm']` and needs none of
 * jsep, so importing `onnxruntime-web/wasm` instead brings the binary back
 * under the ceiling and lets it ship from origin.
 *
 * Serving it from origin is what makes `Cross-Origin-Embedder-Policy:
 * require-corp` safe (see `rails49.org/_headers`), and that header is what
 * makes the deployed site `crossOriginIsolated` — without which ORT silently
 * falls back to a single WASM thread, costing roughly 1.5x on inference (#15).
 *
 * `tests/ortAssets.test.ts` holds the whole chain to these values.
 */

/** Cloudflare Pages rejects any single file larger than this. */
export const CLOUDFLARE_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** The one ORT binary the browser fetches, and the only one the bundle carries. */
export const ORT_WASM_BINARY = 'ort-wasm-simd-threaded.wasm';

const ORT_DIST = 'node_modules/onnxruntime-web/dist';

/**
 * The Emscripten glue ORT loads beside the binary. It resolves against
 * `wasmPaths` like the binary does, so it has to be copied too — and it is the
 * *only* other file that ever is: the rest of ORT reaches the browser through
 * Rollup, from the `onnxruntime-web/wasm` import.
 */
export const ORT_WASM_GLUE = 'ort-wasm-simd-threaded.mjs';

/**
 * `vite-plugin-static-copy` targets for the ORT runtime, relative to `ui/`.
 *
 * Both files are named rather than globbed. `*.wasm` would sweep the jsep
 * build back in — it deploys fine locally and Cloudflare rejects it — and
 * `*.{mjs,js}` used to drag 44 MB of webgl, webgpu and node builds into the
 * bundle, none of which anything can fetch.
 */
export const ortCopyTargets = [
  { src: `${ORT_DIST}/${ORT_WASM_BINARY}`, dest: 'ort' },
  { src: `${ORT_DIST}/${ORT_WASM_GLUE}`, dest: 'ort' },
];
