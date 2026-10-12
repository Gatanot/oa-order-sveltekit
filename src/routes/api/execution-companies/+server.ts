import { json } from '@sveltejs/kit';
import { createExecutionCompany, deleteExecutionCompany, listExecutionCompanies, updateExecutionCompany } from '$lib/server/order-db';
import { executionCompanyManageRoles, hasAnyRole } from '$lib/server/identity';
import type { RequestHandler } from './$types';
import type { CurrentIdentity } from '$lib/server/identity';

// 执行公司维护与员工管理同页，但仅系统管理员、老板与执行身份可操作。
function requireManager(identity: CurrentIdentity | null) {
  if (!hasAnyRole(identity, executionCompanyManageRoles)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有执行公司管理权限' } }, { status: 403 });
  }
  return null;
}

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireManager(identity);
  if (denied) return denied;
  return json({ data: listExecutionCompanies() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireManager(identity);
  if (denied) return denied;
  const data = await request.json().catch(() => null);
  try {
    const created = createExecutionCompany(data?.name, { name: identity?.displayName, uid: identity?.uid });
    return json({ data: created }, { status: 201 });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '执行公司新增失败';
    return json({ error: { code: 'INVALID_EXECUTION_COMPANY', message } }, { status: 400 });
  }
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireManager(identity);
  if (denied) return denied;
  const data = await request.json().catch(() => null);
  try {
    const updated = updateExecutionCompany(data?.id, data?.name, { name: identity?.displayName, uid: identity?.uid });
    return json({ data: updated });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '执行公司保存失败';
    return json({ error: { code: 'INVALID_EXECUTION_COMPANY', message } }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireManager(identity);
  if (denied) return denied;
  const data = await request.json().catch(() => null);
  try {
    const removed = deleteExecutionCompany(data?.id, { name: identity?.displayName, uid: identity?.uid });
    return json({ data: removed });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '执行公司删除失败';
    return json({ error: { code: 'INVALID_EXECUTION_COMPANY', message } }, { status: 400 });
  }
};
