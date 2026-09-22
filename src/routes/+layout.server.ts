import type { LayoutServerLoad } from './$types';
import { loadWorkbench } from '$lib/server/workbench';
import { toPublicArtifactVisitor } from '$lib/artifact-visitor';

export const load: LayoutServerLoad = async ({ locals }) => ({
  ...loadWorkbench(),
  visitor: toPublicArtifactVisitor(await locals.getArtifactVisitor())
});
