import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/** 独立 loopback 服务构建，不加载 SvelteKit 或网页鉴权环境。 */
export default defineConfig({
  root,
  resolve: { alias: { $lib: path.resolve(root, 'src/lib') } },
  build: {
    ssr: path.resolve(root, 'src/local-entry.ts'),
    outDir: path.resolve(root, 'build-local'),
    emptyOutDir: true,
    target: 'node20', minify: false, sourcemap: false,
    rollupOptions: { output: { entryFileNames: 'server.js', format: 'es' } }
  },
  ssr: { target: 'node', noExternal: true, external: ['better-sqlite3'] }
});
