import { json } from '@sveltejs/kit';
import { body } from '$lib/server/http';
import { employeeManageRoles, hasAnyRole } from '$lib/server/identity';
import { listDepartmentApproverConfig, setDepartmentApprovers } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!hasAnyRole(identity, employeeManageRoles)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有员工管理权限' } }, { status: 403 });
  }
  return json({ data: listDepartmentApproverConfig() });
};

export const PATCH: RequestHandler = async (event) => {
  const identity = await event.locals.getCurrentIdentity();
  if (!hasAnyRole(identity, employeeManageRoles)) {
    return json({ error: { code: 'FORBIDDEN', message: '没有员工管理权限' } }, { status: 403 });
  }
  const payload = await body(event);
  const department = String(payload.department || '').trim();
  const layers = payload.layers && typeof payload.layers === 'object' && !Array.isArray(payload.layers)
    ? payload.layers as Record<string, unknown>
    : {};
  try {
    const config = setDepartmentApprovers(department, layers, { name: identity?.displayName, uid: identity?.uid });
    return json({ data: config });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message : 'UPDATE_FAILED';
    const message = code === 'INVALID_DEPARTMENT' ? '所属部门格式不正确'
      : code === 'INVALID_APPROVER' ? '审核人格式不正确'
      : code === 'APPROVER_NOT_FOUND' ? '审核人不存在，请先在员工管理中添加'
      : '审批设置保存失败';
    return json({ error: { code, message } }, { status: 400 });
  }
};
