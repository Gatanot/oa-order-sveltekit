#!/usr/bin/env node
// 云端工具执行器示例：服务密钥只在运行环境配置，不作为模型工具参数。
import { readFileSync } from 'node:fs';
import { createCatscoOaTools } from '../src/lib/server/catsco-oa-tools.js';

try {
  const appBaseUrl = process.env.OA_BASE_URL || '';
  const apiKey = process.env.OA_AI_SERVICE_KEY || '';
  if (!appBaseUrl) throw new Error('请由管理员设置 OA_BASE_URL 和 OA_AI_SERVICE_KEY；不需要员工 Cookie 或浏览器登录。');
  const adapter = createCatscoOaTools({ appBaseUrl, apiKey });
  const command = process.argv[2] || 'me';
  let result;
  if (command === 'me') result = await adapter.execute('oa_agent_info', {});
  else if (command === 'tools') result = { tools: await adapter.listTools() };
  else if (command === 'call') {
    const request = JSON.parse(readFileSync(0, 'utf8'));
    if (!request || typeof request !== 'object' || typeof request.name !== 'string' || Object.keys(request).some((key) => !['name', 'arguments'].includes(key))) throw new Error('输入应为 {"name":"oa_orders_工具名 或 oa_catalog_工具名","arguments":{...}}');
    result = await adapter.execute(request.name, request.arguments);
  } else throw new Error('命令必须为 me、tools 或 call（从 stdin 读取 JSON）');
  console.log(JSON.stringify(result, null, 2));
  if (result?.error) process.exitCode = 1;
} catch (reason) {
  console.error(reason instanceof Error ? reason.message : 'OA 工具调用失败');
  process.exitCode = 1;
}
