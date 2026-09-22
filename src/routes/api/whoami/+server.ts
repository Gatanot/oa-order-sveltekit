import { json } from '@sveltejs/kit';
import { toPublicArtifactVisitor } from '$lib/artifact-visitor';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const visitor = await locals.getArtifactVisitor();
  const body = toPublicArtifactVisitor(visitor);
  return json(body, { status: visitor.status === 'unavailable' ? 503 : 200 });
};
