import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // 工作台会被 Artifact 入口以 sandbox iframe 内嵌，表单上传的 Origin 可能是 null。
    // 关闭框架自带的 Origin 校验，改在 hooks.server.ts 中校验同源或自定义请求头。
    csrf: { checkOrigin: false }
  }
};

export default config;
