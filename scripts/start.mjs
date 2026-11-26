import { existsSync } from 'node:fs';
import process from 'node:process';

// node build 不会自动读取 .env；这里统一加载，并给附件上传设置足够的请求体上限。
if (existsSync('.env')) {
  try { process.loadEnvFile('.env'); } catch { /* 保持外部环境变量优先 */ }
}
process.env.BODY_SIZE_LIMIT ||= '12582912';

await import('../build/index.js');
