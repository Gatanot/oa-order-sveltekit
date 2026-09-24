import { json } from '@sveltejs/kit';
import { addAuditLog } from '$lib/server/order-db';
import { departments, employeeRoles, listEmployees, updateEmployee } from '$lib/server/identity';
import type { RequestHandler } from './$types';
import type { CurrentIdentity } from '$lib/server/identity';

function requireAdmin(identity: CurrentIdentity | null) {
  if (!identity || !['admin', 'manager', 'owner'].includes(identity.role)) return json({ error: { code: 'FORBIDDEN', message: '没有员工管理权限' } }, { status: 403 });
  return null;
}

export const GET: RequestHandler = async ({ locals }) => {
  const denied = requireAdmin(await locals.getCurrentIdentity());
  if (denied) return denied;
  return json({ data: listEmployees(), departments, roles: employeeRoles });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireAdmin(identity);
  if (denied) return denied;
  const data = await request.json().catch(() => null);
  if (!data || !Number.isSafeInteger(Number(data.uid)) || typeof data.active !== 'boolean') {
    return json({ error: { code: 'INVALID_REQUEST', message: '员工资料格式不正确' } }, { status: 400 });
  }
  try {
    const role = String(data.role || '');
    if (identity?.role === 'manager' && ['manager', 'owner', 'finance'].includes(role)) {
      return json({ error: { code: 'FORBIDDEN', message: '管理人员不能授予管理、老板或财务身份' } }, { status: 403 });
    }
    const updated = updateEmployee(Number(data.uid), {
      display_name: String(data.display_name || ''),
      department: String(data.department || ''),
      role,
      active: data.active
    });
    addAuditLog({ actorName: identity?.displayName, action: 'update_employee', entityType: 'employee', entityId: String(data.uid), detail: { role, department: updated.department, active: updated.active } });
    return json({ data: updated });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '更新员工失败';
    return json({ error: { code: message, message } }, { status: 400 });
  }
};
