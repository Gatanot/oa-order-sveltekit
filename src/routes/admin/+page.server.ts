import { error, fail, redirect } from '@sveltejs/kit';
import { getAdminDemoStats, seedDemoCostCatalogs, seedDemoOrdersAndReimbursements } from '$lib/server/order-db';
import { createIdentitySwitchToken, IDENTITY_SWITCH_COOKIE, listIdentitySwitchOptions } from '$lib/server/identity';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getAdminIdentity();
  if (!identity || identity.role !== 'admin') error(403, '仅系统管理员可访问');
  const current = await locals.getCurrentIdentity();
  return { stats: getAdminDemoStats(), role: identity.role, currentIdentity: current, employees: listIdentitySwitchOptions() };
};

export const actions: Actions = {
  switchIdentity: async ({ request, locals, cookies }) => {
    const identity = await locals.getAdminIdentity();
    if (!identity || identity.role !== 'admin') return fail(403, { success: false, message: '仅系统管理员可切换业务身份' });
    const form = await request.formData();
    const selected = String(form.get('identity') || '');
    const [uidText, role] = selected.split(':');
    const uid = Number(uidText);
    const option = listIdentitySwitchOptions().find((item) => item.catsco_uid === uid && item.role === role);
    if (!option || role === 'pending') return fail(400, { success: false, message: '请选择有效的业务身份' });
    cookies.set(IDENTITY_SWITCH_COOKIE, createIdentitySwitchToken(uid, role as any), { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    throw redirect(303, '/orders');
  },
  clearIdentity: async ({ locals, cookies }) => {
    const identity = await locals.getAdminIdentity();
    if (!identity || identity.role !== 'admin') return fail(403, { success: false, message: '仅系统管理员可恢复管理员身份' });
    cookies.delete(IDENTITY_SWITCH_COOKIE, { path: '/' });
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
