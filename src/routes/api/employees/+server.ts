import { json } from '@sveltejs/kit';
import { addAuditLog } from '$lib/server/order-db';
import { departments, employeeManageRoles, employeeRoles, hasAnyRole, listEmployees, updateEmployee } from '$lib/server/identity';
import type { RequestHandler } from './$types';
import type { CurrentIdentity } from '$lib/server/identity';

function requireAdmin(identity: CurrentIdentity | null) {
  if (!hasAnyRole(identity, employeeManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有员工管理权限' } }, { status: 403 });
  return null;
}

export const GET: RequestHandler = async ({ locals }) => {
  const denied = requireAdmin(await locals.getCurrentIdentity());
  if (denied) return denied;
  return json({ data: listEmployees(), departments, roles: employeeRoles });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireAdmin(identity);
  if (denied) return denied;
  const data = await request.json().catch(() => null);
  const uid = Number(data?.uid);
  const username = String(data?.username || '').trim();
  if (!Number.isSafeInteger(uid) || uid <= 0 || !username || uid === 826) {
    return json({ error: { code: 'INVALID_REQUEST', message: 'UID 或用户名格式不正确' } }, { status: 400 });
  }
  try {
    const { getOrderDb } = await import('$lib/server/order-db');
    const timestamp = new Date().toISOString();
    getOrderDb().prepare('INSERT INTO employees(catsco_uid,username,display_name,department,role,active,created_at,updated_at) VALUES(?,?,?,\'\',\'pending\',0,?,?)')
      .run(uid, username, username, timestamp, timestamp);
    addAuditLog({ actorName: identity?.displayName, action: 'create_employee', entityType: 'employee', entityId: String(uid) });
    return json({ data: { catsco_uid: uid, username, display_name: username, department: '', role: 'pending', active: 0 } }, { status: 201 });
  } catch {
    return json({ error: { code: 'EMPLOYEE_EXISTS', message: '该 UID 已存在或无法创建' } }, { status: 409 });
  }
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireAdmin(identity);
  if (denied) return denied;
  const data = await request.json().catch(() => null);
  const uid = Number(data?.uid);
  if (!Number.isSafeInteger(uid) || uid <= 0 || uid === 826) return json({ error: { code: 'INVALID_REQUEST', message: 'UID 不合法' } }, { status: 400 });
  const { getOrderDb } = await import('$lib/server/order-db');
  const result = getOrderDb().prepare('DELETE FROM employees WHERE catsco_uid=?').run(uid);
  if (!result.changes) return json({ error: { code: 'EMPLOYEE_NOT_FOUND', message: '员工不存在' } }, { status: 404 });
  addAuditLog({ actorName: identity?.displayName, action: 'delete_employee', entityType: 'employee', entityId: String(uid) });
  return json({ data: { uid } });
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
