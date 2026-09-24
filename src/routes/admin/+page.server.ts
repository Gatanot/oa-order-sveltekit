import { error, fail } from '@sveltejs/kit';
import { getAdminDemoStats, seedDemoCostCatalogs, seedDemoOrdersAndReimbursements } from '$lib/server/order-db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity || !['admin', 'manager', 'owner'].includes(identity.role)) error(403, '没有员工管理权限');
  return { stats: identity.role === 'admin' ? getAdminDemoStats() : null, role: identity.role };
};

export const actions: Actions = {
  catalogs: async ({ request, locals }) => {
    if ((await locals.getCurrentIdentity())?.role !== 'admin') return fail(403, { success: false, message: '仅 Catsco 管理员可执行此操作' });
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
    if ((await locals.getCurrentIdentity())?.role !== 'admin') return fail(403, { success: false, message: '仅 Catsco 管理员可执行此操作' });
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
