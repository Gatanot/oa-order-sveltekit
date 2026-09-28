import { error, fail, redirect } from '@sveltejs/kit';
import { addAuditLog, getAdminDemoStats, seedDemoCostCatalogs, seedDemoOrdersAndReimbursements } from '$lib/server/order-db';
import { employeeRoles, getAdminExtraIdentity, setAdminExtraIdentity } from '$lib/server/identity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getAdminIdentity();
  if (!identity || identity.role !== 'admin') error(403, '仅系统管理员可访问');
  const current = await locals.getCurrentIdentity();
  return { stats: getAdminDemoStats(), role: identity.role, currentIdentity: current, extraIdentity: getAdminExtraIdentity(), roles: employeeRoles };
};

export const actions: Actions = {
  saveExtraIdentity: async ({ request, locals }) => {
    const identity = await locals.getAdminIdentity();
    if (!identity || identity.role !== 'admin') return fail(403, { success: false, message: '仅系统管理员可设置额外身份' });
    const form = await request.formData();
    const role = String(form.get('role') || '');
    if (!employeeRoles.includes(role as typeof employeeRoles[number])) return fail(400, { success: false, message: '请选择有效的业务身份' });
    const previousRole = getAdminExtraIdentity()?.role || '';
    setAdminExtraIdentity(role as typeof employeeRoles[number]);
    addAuditLog({ actorName: identity.displayName, action: 'set_admin_extra_identity', entityType: 'system_admin_identity', entityId: '826', fromValue: previousRole, toValue: role });
    throw redirect(303, '/orders');
  },
  clearExtraIdentity: async ({ locals }) => {
    const identity = await locals.getAdminIdentity();
    if (!identity || identity.role !== 'admin') return fail(403, { success: false, message: '仅系统管理员可移除额外身份' });
    const previousRole = getAdminExtraIdentity()?.role || '';
    setAdminExtraIdentity(null);
    addAuditLog({ actorName: identity.displayName, action: 'clear_admin_extra_identity', entityType: 'system_admin_identity', entityId: '826', fromValue: previousRole, toValue: '' });
    throw redirect(303, '/admin');
  },
  catalogs: async ({ request, locals }) => {
    if ((await locals.getAdminIdentity())?.role !== 'admin') return fail(403, { success: false, message: '仅 Catsco 管理员可执行此操作' });
    try {
      const form = await request.formData();
      const count = Number(form.get('count') || 2);
      const result = seedDemoCostCatalogs(count);
      return { success: true, action: 'catalogs', result, stats: getAdminDemoStats() };
    } catch (reason) {
      return fail(400, {
        success: false,
        action: 'catalogs',
        message: reason instanceof Error ? reason.message : '厂商成本库模拟数据生成失败',
      });
    }
  },
  operations: async ({ request, locals }) => {
    if ((await locals.getAdminIdentity())?.role !== 'admin') return fail(403, { success: false, message: '仅 Catsco 管理员可执行此操作' });
    try {
      const form = await request.formData();
      const count = Number(form.get('count') || 36);
      const result = seedDemoOrdersAndReimbursements(count);
      return { success: true, action: 'operations', result, stats: getAdminDemoStats() };
    } catch (reason) {
      return fail(400, {
        success: false,
        action: 'operations',
        message: reason instanceof Error ? reason.message : '订单与报销模拟数据生成失败',
      });
    }
  },
};
