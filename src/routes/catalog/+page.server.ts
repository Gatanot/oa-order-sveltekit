import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadCatalogSection } from '$lib/server/workbench';

// 报价库只在进入本页时随页面下发；直接刷新本页也能拿到首屏数据，无需等客户端二次请求。
export const load: PageServerLoad = async ({ locals }) => {
  const identity = await locals.getCurrentIdentity();
  if (!identity) error(401, '请通过 Catsco 登录后访问');
  return loadCatalogSection(identity);
};
