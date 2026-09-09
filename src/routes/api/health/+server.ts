import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';

export function GET() {
  getDb().prepare('SELECT 1').get();
  return json({ ok: true, service: 'oa-order-sveltekit', database: 'sqlite', time: new Date().toISOString() });
}
