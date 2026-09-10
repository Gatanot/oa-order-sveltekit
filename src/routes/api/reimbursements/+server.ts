import { json } from '@sveltejs/kit';
import { getOrderDb, listReimbursementOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => json({ data: listReimbursementOrders({
  project: url.searchParams.get('project') || '', person: url.searchParams.get('person') || '',
  from: url.searchParams.get('from') || '', to: url.searchParams.get('to') || '', status: url.searchParams.get('status') || ''
}) });
