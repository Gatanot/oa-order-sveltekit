import { json } from '@sveltejs/kit';
import { listCustomers } from '$lib/server/order-db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ data: listCustomers() });
