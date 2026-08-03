import { defineConfig, type UserConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import basicSsl from '@vitejs/plugin-basic-ssl';
import type { InlineConfig } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ORT_WASM_BINARY, ortCopyTargets } from './ortAssets.js';

interface VitestConfig extends UserConfig {
  test?: InlineConfig;
}

/**
 * ORT's bundle build carries `new URL('<binary>', import.meta.url)` for the
 * case where nothing sets `ort.env.wasm.wasmPaths`, and Rollup turns that into
 * a second emitted copy of the 13 MB binary. `rr-live-view` always sets the
 * path, so that copy is 13 MB of bytes nothing can ever fetch — drop it and
 * leave `ort/` as the one place the runtime lives.
 */
const dropUnfetchableOrtWasm = {
  name: 'rr-drop-unfetchable-ort-wasm',
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    // `.wasm` only, and matched on the hashed name Rollup gives it. The glue
    // shares this prefix; it is inlined today, but were it ever emitted on its
    // own, deleting it would take out the threading this change exists to buy.
    const stem = path.basename(ORT_WASM_BINARY, '.wasm');
    for (const name of Object.keys(bundle)) {
      const file = path.basename(name);
      if (file.endsWith('.wasm') && file.startsWith(stem)) delete bundle[name];
    }
  },
};

const includeModels = fs.existsSync(path.resolve(__dirname, '../classifier/resnet/models'));

const config: VitestConfig = {
  base: '/ui/',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@shoelace-style/shoelace/dist/assets',
          dest: 'shoelace',
        },
        ...ortCopyTargets,
        // Only the quantized model ships. The fp32 model.ort is 45 MB, over
        // Cloudflare Pages' 25 MiB per-file limit; model_int8.ort is 11 MB.
        ...(includeModels ? [{
          src: '../classifier/resnet/models/{model_int8.ort,config.json}',
          dest: 'models',
        }] : []),
      ],
    }) as any,
    dropUnfetchableOrtWasm,
    ...(process.env.HTTP ? [] : [basicSsl()]),
  ],
  resolve: {
    dedupe: ['lit', 'lit-html', 'lit-element'],
  },
  server: {
    host: true,
    fs: {
      allow: ['..'],
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'onnx-vendor': ['onnxruntime-web/wasm'],
        },
      },
    },
  },
};

export default defineConfig(config);
