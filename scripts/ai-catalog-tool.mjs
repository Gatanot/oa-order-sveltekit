#!/usr/bin/env node
/**
 * 本机 OA 工具 CLI：无密钥、无 Cookie，只连接 http://127.0.0.1:<端口>/。
 * 可选配置仅 OA_LOCAL_URL（默认 http://127.0.0.1:3101/）。
 *
 * 用法：
 *   node scripts/ai-catalog-tool.mjs me
 *   node scripts/ai-catalog-tool.mjs tool oa_orders_search_orders '{"query":"阀门"}'
 *   node scripts/ai-catalog-tool.mjs call < request.json
 *
 * request.json 形如 {"name":"oa_orders_search_orders","arguments":{...}}，
 * 只接受 name 与 arguments 两个字段。
 */
import { readFileSync } from 'node:fs';
import { createCatscoOaTools } from '../src/lib/server/catsco-oa-tools.js';

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:3101/';
const allowedRequestKeys = new Set(['name', 'arguments']);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readJson(source, label) {
  const text = source.trim();
  if (!text) throw new Error(`${label} 不能为空`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} 必须是有效 JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`);
  return value;
}

try {
  // 只读取本机入口地址，不接受密钥或远程地址；未设置时使用默认端口。
  const appBaseUrl = process.env.OA_LOCAL_URL?.trim() || DEFAULT_LOCAL_URL;
  const adapter = createCatscoOaTools({ appBaseUrl });

  const command = process.argv[2] || 'me';
  let result;
  if (command === 'me') {
    result = await adapter.execute('oa_entry_info', {});
  } else if (command === 'tool') {
    const name = process.argv[3];
    if (!name) throw new Error('用法：tool <工具名> [arguments-json]');
    const args = process.argv[4] === undefined ? {} : readJson(process.argv[4], 'arguments');
    result = await adapter.execute(name, args);
  } else if (command === 'call') {
    const request = readJson(readFileSync(0, 'utf8'), 'stdin');
    if (Object.keys(request).some((key) => !allowedRequestKeys.has(key))) {
      throw new Error('输入只能包含 name 与 arguments');
    }
    if (typeof request.name !== 'string' || !request.name) throw new Error('输入必须包含字符串 name');
    const args = request.arguments === undefined ? {} : request.arguments;
    result = await adapter.execute(request.name, args);
  } else if (command === 'tools') {
    result = { tools: await adapter.listTools() };
  } else {
    throw new Error('命令必须为 me、tools、tool 或 call');
  }

  console.log(JSON.stringify(result, null, 2));
  if (result?.error) process.exitCode = 1;
} catch (reason) {
  // 不打印堆栈或原始异常细节，避免泄露本机路径与请求内部信息。
  fail(reason instanceof Error ? reason.message : '本机 OA 工具调用失败');
}
