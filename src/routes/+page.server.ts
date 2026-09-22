import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Artifact 网关会在浏览器侧保留 /<应用id>/ 前缀，使用相对 Location 才不会跳出应用。
export const load: PageServerLoad = () => redirect(303, './orders');
