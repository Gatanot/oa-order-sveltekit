import { fail } from '@sveltejs/kit';
import { getAdminDemoStats, seedDemoCostCatalogs, seedDemoOrdersAndReimbursements } from '$lib/server/order-db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ stats: getAdminDemoStats() });

export const actions: Actions = {
  catalogs: async ({ request }) => {
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
  operations: async ({ request }) => {
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
