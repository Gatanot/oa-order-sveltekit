import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = ({ params }) => {
  redirect(307, `/workspace/${encodeURIComponent(params.order)}/dashboard`);
};
