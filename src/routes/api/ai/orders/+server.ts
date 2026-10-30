import { isHttpError, json } from '@sveltejs/kit';
import { body } from '$lib/server/http';
import { OrderToolError, orderPermissions, orderTools, runOrderTool } from '$lib/server/ai-orders';
import type { RequestHandler } from './$types';

// 受信任共享服务 Agent 模式：仅接受服务端注入的 AI 路由身份，无浏览器登录 fallback。
const headers = { 'Cache-Control': 'no-store' };

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getAiIdentity();
  if (!identity || identity.kind !== 'service_agent' || !orderPermissions(identity).read) return json({ error: { code: 'FORBIDDEN', message: 'AI 服务身份不可操作订单' } }, { status: 403, headers });
  const permissions = orderPermissions(identity);
  return json({ data: {
    version: 2,
    identity: {
      mode: 'service_agent',
      supplied_by: 'trusted_host',
      agent_id: identity.agentId,
      display_name: identity.displayName,
      model_can_select_user: false
    },
    description: '订单工具（共享服务 Agent）：AI 提交业务参数，身份由 OA 服务端配置注入，不依赖浏览器登录。创建/批量创建必须用 order.created_by_uid 指定归属员工（已开通在职，姓名取自员工档案）；也可更新归属。所有金额为人民币元字符串；写入默认预览；不开放删除、结款或状态变更。',
    permissions,
    tools: orderTools.filter((tool) => (tool.name !== 'create_order' && tool.name !== 'batch_create_orders') || permissions.create)
  } }, { headers });
};

export const POST: RequestHandler = async (event) => {
  const identity = await event.locals.getAiIdentity();
  if (!identity || identity.kind !== 'service_agent') return json({ error: { code: 'UNAUTHORIZED', message: '未取得 AI 服务身份，请检查服务端 AI 代理配置' } }, { status: 401, headers });
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
