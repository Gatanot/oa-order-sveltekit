import { isHttpError, json } from '@sveltejs/kit';
import { catalogManageRoles, catalogViewRoles, hasAnyRole } from '$lib/server/identity';
import { body } from '$lib/server/http';
import { CatalogToolError, catalogTools, runCatalogTool } from '$lib/server/ai-catalog';
import type { RequestHandler } from './$types';

const headers = { 'Cache-Control': 'no-store' };
const forbidden = () => json({ error: { code: 'FORBIDDEN', message: '当前业务身份无资料库操作权限' } }, { status: 403, headers });

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getAiIdentity();
  if (!hasAnyRole(identity, catalogViewRoles)) return forbidden();
  return json({ data: {
    version: 2,
    description: '报价/成本库服务工具。由管理员授权的共享 Agent 执行，不依赖员工浏览器登录。dry_run 默认 true；false 为实际提交。',
    identity: { mode: 'service_agent', supplied_by: 'service_key' },
    request: { tool: '工具名称', arguments: '符合 inputSchema 的 JSON 对象' },
    currency: 'CNY', money_unit: 'yuan',
    tools: catalogTools
  } }, { headers });
};

export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getAiIdentity();
  if (!identity || !hasAnyRole(identity, catalogViewRoles)) return forbidden();
  try {
    const request = await body(event);
    for (const key of Object.keys(request)) if (!['tool', 'arguments'].includes(key)) {
      throw new CatalogToolError('VALIDATION_ERROR', '不支持的请求字段', 400, key);
    }
    if (typeof request.tool !== 'string') throw new CatalogToolError('VALIDATION_ERROR', '必须提供工具名称', 400, 'tool');
    const writing = ['create_source', 'upsert_items'].includes(request.tool);
    if (writing && !hasAnyRole(identity, catalogManageRoles)) return forbidden();
    return json({ data: runCatalogTool(request.tool, request.arguments, identity) }, { headers });
  } catch (reason) {
    if (reason instanceof CatalogToolError) return json({ error: { code: reason.code, message: reason.message, ...(reason.path ? { path: reason.path } : {}) } }, { status: reason.status, headers });
    if (isHttpError(reason)) return json({ error: { code: reason.body.message, message: reason.body.message } }, { status: reason.status, headers });
    // 不向调用者泄露 SQL、文件路径或原始异常。
    console.error('AI catalog tool failed', reason);
    return json({ error: { code: 'INTERNAL_ERROR', message: '资料库操作失败，请稍后重试' } }, { status: 500, headers });
  }
};
