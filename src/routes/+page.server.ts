import type { PageServerLoad } from './$types';
import { loadWorkspace } from '$lib/server/workspace';

export const load: PageServerLoad = ({ url }) =>
  loadWorkspace(url.searchParams.get('view') ?? 'dashboard');
