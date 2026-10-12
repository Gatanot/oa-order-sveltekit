import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 把 pdf.js 的 cMap / 标准字体数据复制到 static/，供浏览器按 URL 直接读取。
// 这些文件体积较大且属于第三方资源，不进 Git（见 .gitignore），
// 由 npm 的 predev / prebuild 钩子在开发与构建前同步。
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'static', 'pdfjs');

async function copyDirectory(name) {
  const from = join(source, name);
  const info = await stat(from).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`找不到 pdfjs-dist 的 ${name} 目录：${from}，请先执行 npm install`);
  }
  await cp(from, join(target, name), { recursive: true });
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await copyDirectory('cmaps');
await copyDirectory('standard_fonts');
console.log('[sync-pdfjs-assets] 已同步 pdfjs cmaps / standard_fonts 到 static/pdfjs');
