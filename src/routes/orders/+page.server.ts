import type { PageServerLoad } from './$types';
import { loadWorkbench } from '$lib/server/workbench';
export const load: PageServerLoad = () => loadWorkbench();
