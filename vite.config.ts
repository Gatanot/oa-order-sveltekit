import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  // 平台网关按上游并发连接数限流，首屏一次性预加载过多分片会触发 503。
  // 将小于 100KB 的碎片分片合并进更大的分片，减少首屏并发请求数。
  build: {
    rollupOptions: {
      output: {
        experimentalMinChunkSize: 100_000
      }
    }
  },
  server: { host: '0.0.0.0', port: 5173 }
});
