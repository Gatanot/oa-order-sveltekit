import { json } from '@sveltejs/kit';
import { listReimbursementOrders } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => json({ data: listReimbursementOrders(Object.fromEntries(url.searchParams)) });
