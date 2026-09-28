import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { loadWorkbench } from '$lib/server/workbench';
import { toPublicArtifactVisitor } from '$lib/artifact-visitor';

export const load: LayoutServerLoad = async ({ locals }) => {
  const visitor = await locals.getArtifactVisitor();
  const identity = await locals.getCurrentIdentity();
  if (!identity) error(visitor.status === 'unavailable' ? 503 : 401, '请通过 Catsco 登录后访问');
  if (identity.role !== 'admin' && (!identity.active || identity.role === 'pending')) error(403, '账户待管理员开通');
  return { ...loadWorkbench(identity), visitor: toPublicArtifactVisitor(visitor), identity };
};
