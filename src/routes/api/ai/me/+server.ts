import { json } from '@sveltejs/kit';
import { orderPermissions } from '$lib/server/ai-orders';
import type { RequestHandler } from './$types';

/** 返回服务执行者，不再表示某位浏览器登录员工。 */
export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getAiIdentity();
  const headers = { 'Cache-Control': 'no-store' };
  if (!identity) return json({ error: { code: 'AGENT_AUTH_REQUIRED', message: '请联系管理员配置 Agent 服务接入' } }, { status: 401, headers });
  return json({ data: {
    kind: identity.kind, agent_id: identity.agentId, display_name: identity.displayName,
    permissions: { catalog: { read: true, manage: true }, orders: orderPermissions(identity) }
  } }, { headers });
};
