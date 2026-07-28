import { defineConfig, type UserConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import basicSsl from '@vitejs/plugin-basic-ssl';
import type { InlineConfig } from 'vitest';
import fs from 'fs';
import path from 'path';

// Helper to load RAILS_DOMAIN from config.json (or config.yaml as fallback)
function getRailsDomain(): string {
  if (process.env.RAILS_DOMAIN) {
    return process.env.RAILS_DOMAIN.trim();
  }
  try {
    const configJsonPath = path.resolve(__dirname, '../config.json');
    if (fs.existsSync(configJsonPath)) {
      const config = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'));
      if (config.global?.rails_domain) {
        return config.global.rails_domain.trim();
      }
    }
  } catch (e) {
    // Fallback if json parse fails
  }
  try {
    const configYamlPath = path.resolve(__dirname, '../config.yaml');
    if (fs.existsSync(configYamlPath)) {
      const configContent = fs.readFileSync(configYamlPath, 'utf8');
      const match = configContent.match(/rails_domain\s*:\s*["']?([^"'\s\n\r]+)["']?/);
      if (match) {
        return match[1].trim();
      }
    }
  } catch (e) {
    // Fallback if file not found
  }
  return 'rails49.org';
}

interface VitestConfig extends UserConfig {
  test?: InlineConfig;
}

const includeModels = fs.existsSync(path.resolve(__dirname, '../classifier/resnet/models'));

const config: VitestConfig = {
  base: '/ui/',
  define: {
    __RAILS_DOMAIN__: JSON.stringify(getRailsDomain()),
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/@shoelace-style/shoelace/dist/assets',
          dest: 'shoelace',
        },
        {
          src: 'node_modules/onnxruntime-web/dist/*.{wasm,mjs,js}',
          dest: 'ort',
        },
        // Only the quantized model ships. The fp32 model.ort is 45 MB, over
        // Cloudflare Pages' 25 MiB per-file limit; model_int8.ort is 11 MB.
        ...(includeModels ? [{
          src: '../classifier/resnet/models/{model_int8.ort,config.json}',
          dest: 'models',
        }] : []),
      ],
    }) as any,
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
          'onnx-vendor': ['onnxruntime-web'],
        },
      },
    },
  },
};

export default defineConfig(config);
