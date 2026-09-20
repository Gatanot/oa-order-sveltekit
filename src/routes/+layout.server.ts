import type { LayoutServerLoad } from './$types';
import { loadWorkbench } from '$lib/server/workbench';

export const load: LayoutServerLoad = () => loadWorkbench();
