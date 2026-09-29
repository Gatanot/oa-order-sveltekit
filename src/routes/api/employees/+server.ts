import { json } from '@sveltejs/kit';
import { addAuditLog } from '$lib/server/order-db';
import { departments, employeeManageRoles, employeeRoles, hasAnyRole, listEmployees, updateEmployee, canManageEmployee } from '$lib/server/identity';
import type { RequestHandler } from './$types';
import type { CurrentIdentity } from '$lib/server/identity';

function requireAdmin(identity: CurrentIdentity | null) {
  if (!hasAnyRole(identity, employeeManageRoles)) return json({ error: { code: 'FORBIDDEN', message: '没有员工管理权限' } }, { status: 403 });
  return null;
}

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  const denied = requireAdmin(identity);
  if (denied) return denied;
  // 同时下发 isSelf / canManage，前端据此禁用无权或不能自改的字段，服务端仍是唯一授权依据。
  const data = listEmployees().map((employee) => ({
    ...employee,
    isSelf: identity?.uid === employee.catsco_uid,
    canManage: canManageEmployee(identity, employee)
  }));
  return json({ data, departments, roles: employeeRoles });
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
    addAuditLog({ actorName: identity?.displayName, actorUid: identity?.uid, action: 'create_employee', entityType: 'employee', entityId: String(uid) });
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
  const target = getOrderDb().prepare('SELECT catsco_uid,role FROM employees WHERE catsco_uid=?').get(uid) as { catsco_uid: number; role: string } | undefined;
  if (!target) return json({ error: { code: 'EMPLOYEE_NOT_FOUND', message: '员工不存在' } }, { status: 404 });
  if (!canManageEmployee(identity, target)) {
    return json({ error: { code: 'FORBIDDEN', message: '不能删除同级或更高级别的员工' } }, { status: 403 });
  }
  const result = getOrderDb().prepare('DELETE FROM employees WHERE catsco_uid=?').run(uid);
  if (!result.changes) return json({ error: { code: 'EMPLOYEE_NOT_FOUND', message: '员工不存在' } }, { status: 404 });
  addAuditLog({ actorName: identity?.displayName, actorUid: identity?.uid, action: 'delete_employee', entityType: 'employee', entityId: String(uid) });
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
  if (Number(data.uid) === 826) {
    return json({ error: { code: 'INVALID_EMPLOYEE', message: '固定管理员身份不能被员工档案修改或授予' } }, { status: 400 });
  }
  try {
    const role = String(data.role || '');
    const { getOrderDb } = await import('$lib/server/order-db');
    const current = getOrderDb().prepare('SELECT catsco_uid,role,active FROM employees WHERE catsco_uid=?').get(Number(data.uid)) as { catsco_uid: number; role: string; active: number } | undefined;
    if (!current) return json({ error: { code: 'EMPLOYEE_NOT_FOUND', message: '员工不存在' } }, { status: 404 });
    const isSelf = identity?.uid === current.catsco_uid;
    if (isSelf && identity?.role !== 'admin') {
      // 非管理员只能维护自己的姓名与部门，不能修改自己的身份或启用状态，避免自我提权/自锁。
      if (role !== current.role || data.active !== (current.active === 1)) {
        return json({ error: { code: 'FORBIDDEN', message: '不能修改自己的身份或启用状态' } }, { status: 403 });
      }
    } else if (!canManageEmployee(identity, current)) {
      return json({ error: { code: 'FORBIDDEN', message: '不能管理同级或更高级别的员工' } }, { status: 403 });
    }
    if (identity?.role === 'manager' && role !== current.role && ['manager', 'owner', 'finance'].includes(role)) {
      return json({ error: { code: 'FORBIDDEN', message: '管理人员不能授予管理、老板或财务身份' } }, { status: 403 });
    }
    const updated = updateEmployee(Number(data.uid), {
      display_name: String(data.display_name || ''),
      department: String(data.department || ''),
      role,
      active: data.active
    });
    addAuditLog({ actorName: identity?.displayName, actorUid: identity?.uid, action: 'update_employee', entityType: 'employee', entityId: String(data.uid), detail: { role, department: updated.department, active: updated.active } });
    return json({ data: updated });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : '更新员工失败';
    return json({ error: { code: message, message } }, { status: 400 });
  }
};
