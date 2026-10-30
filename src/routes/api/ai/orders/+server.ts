import { isHttpError, json } from '@sveltejs/kit';
import { body } from '$lib/server/http';
import { OrderToolError, orderPermissions, orderTools, runOrderTool } from '$lib/server/ai-orders';
import type { RequestHandler } from './$types';

const headers = { 'Cache-Control': 'no-store' };
export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity || !orderPermissions(identity).read) return json({ error: { code: 'FORBIDDEN', message: '当前身份不可操作订单' } }, { status: 403, headers });
  const permissions = orderPermissions(identity);
  return json({ data: {
    version: 1, identity: { mode: 'current_user', supplied_by: 'trusted_host', model_can_select_user: false },
    description: '订单工具：AI 仅提供业务参数，身份绑定当前用户。所有金额为人民币元字符串；写入默认预览；不开放删除、结款或状态变更。',
    permissions, tools: orderTools.filter((tool) => tool.name !== 'create_order' || permissions.create)
  } }, { headers });
};
export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!identity) return json({ error: { code: 'LOGIN_REQUIRED', message: '请登录 Catsco 后重新发起操作，无需向 AI 提供凭据' } }, { status: 401, headers });
  try {
    const data = await body(event);
    for (const key of Object.keys(data)) if (!['tool', 'arguments'].includes(key)) throw new OrderToolError('VALIDATION_ERROR', '不支持的请求字段', 400, key);
    if (typeof data.tool !== 'string') throw new OrderToolError('VALIDATION_ERROR', '必须提供工具名称', 400, 'tool');
    return json({ data: runOrderTool(data.tool, data.arguments, identity) }, { headers });
  } catch (reason) {
    if (reason instanceof OrderToolError) return json({ error: { code: reason.code, message: reason.message, ...(reason.path ? { path: reason.path } : {}) } }, { status: reason.status, headers });
    if (isHttpError(reason)) return json({ error: { code: reason.body.message, message: reason.body.message } }, { status: reason.status, headers });
    console.error('AI order tool failed', reason);
    return json({ error: { code: 'INTERNAL_ERROR', message: '订单操作失败，请稍后重试；提交结果不确定时先查询，勿盲目重试' } }, { status: 500, headers });
  }
};
