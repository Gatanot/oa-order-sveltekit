import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import type { CurrentIdentity } from '$lib/server/identity';

/** 独立的服务执行者。uid=-1 仅供内部权限兼容，不是任何员工或固定管理员 UID。 */
export type AiServiceIdentity = CurrentIdentity & { kind: 'service_agent'; agentId: string };

/** 仅 AI 路由使用此密钥，不回退浏览器登录态，也不赋予网页/员工管理接口权限。 */
export function resolveAiServiceIdentity(request: Request): AiServiceIdentity | null {
  const expected = env.OA_AI_SERVICE_KEY || '';
  // 配置为空、太短或格式无效时关闭接口；与客户端适配器的规则一致。
  if (expected.length < 32 || /\s|[\x00-\x1f\x7f]/.test(expected)) return null;
  const supplied = request.headers.get('x-oa-agent-key') || '';
  if (!supplied || supplied.length > 4096) return null;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(expected), digest(supplied))) return null;
  const agentId = env.OA_AI_SERVICE_ID?.trim() || 'shared-agent';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(agentId)) return null;
  return {
    kind: 'service_agent', agentId, uid: -1, username: agentId,
    displayName: env.OA_AI_SERVICE_NAME?.trim() || 'OA 代办 Agent',
    role: 'admin', department: '', active: true
  };
}

/** 审计中执行者是服务 Agent，不伪装成订单归属员工或系统管理员。 */
export function auditActor(identity: CurrentIdentity) {
  return {
    actorUid: 'kind' in identity && identity.kind === 'service_agent' ? null : identity.uid,
    actorName: identity.displayName
  };
}
export function auditDetail(identity: CurrentIdentity): Record<string, unknown> {
  if ('kind' in identity && identity.kind === 'service_agent' && 'agentId' in identity) {
    return { channel: 'ai_service', agent_id: identity.agentId };
  }
  return { channel: 'ai_tool' };
}
