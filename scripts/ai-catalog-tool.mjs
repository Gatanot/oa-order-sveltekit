#!/usr/bin/env node
// 仅限维护人员本地调试，不注册成 AI 工具，不让模型设置或读取该进程环境。
// 正式 Catsco 接入使用 src/lib/server/catsco-oa-tools.js，按当前用户请求绑定身份。
// OA_BASE_URL 必须包含部署子路径；例如 https://artifact.catsco.cc/<app-id>/。
import { readFileSync } from 'node:fs';

if (process.env.OA_DEV_CLI !== '1') {
  console.error('此脚本仅供人工本地调试。Catsco AI 请使用可信宿主适配器自动绑定当前用户；不要向 AI 提供凭据。维护人员调试需显式设置 OA_DEV_CLI=1。');
  process.exit(1);
}
const base = process.env.OA_BASE_URL;
if (!base) {
  console.error('请设置 OA_BASE_URL，以及 OA_AUTHORIZATION 或 OA_COOKIE。命令：me | tools | call（从 stdin 读取 JSON）');
  process.exit(1);
}
try {
  const url = new URL(base.endsWith('/') ? base : `${base}/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('OA_BASE_URL 必须是无查询参数和凭据的 HTTP(S) 应用地址');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程地址必须使用 HTTPS');
  const command = process.argv[2] || 'me';
  if (!['me', 'tools', 'call'].includes(command)) throw new Error('命令必须是 me、tools 或 call');
  const headers = { Accept: 'application/json' };
  if (process.env.OA_AUTHORIZATION) headers.Authorization = process.env.OA_AUTHORIZATION;
  if (process.env.OA_COOKIE) headers.Cookie = process.env.OA_COOKIE;
  let body;
  if (command === 'call') {
    body = JSON.stringify(JSON.parse(readFileSync(0, 'utf8')));
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(new URL(command === 'me' ? 'api/ai/me' : 'api/ai/catalog', url), {
    method: command === 'call' ? 'POST' : 'GET', headers, body,
    redirect: 'error', signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : '调用失败');
  process.exitCode = 1;
}
