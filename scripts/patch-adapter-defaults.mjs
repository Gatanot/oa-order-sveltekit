import { readFileSync, writeFileSync } from 'node:fs';

// adapter-node 默认只允许 512KB 请求体，低于 10MB 附件上限。
// 在构建产物中把默认值调到 12MB，保证直接 `node build` 启动时附件上传也能工作；
// 如部署环境显式设置 BODY_SIZE_LIMIT，仍以环境变量为准。
const file = 'build/handler.js';
const before = "parse_body_size_limit(env('BODY_SIZE_LIMIT', '512K'))";
const after = "parse_body_size_limit(env('BODY_SIZE_LIMIT', '12582912'))";
const code = readFileSync(file, 'utf8');
if (code.includes(after)) process.exit(0);
if (!code.includes(before)) {
  throw new Error('adapter-node BODY_SIZE_LIMIT default changed; update scripts/patch-adapter-defaults.mjs');
}
writeFileSync(file, code.replace(before, after));
