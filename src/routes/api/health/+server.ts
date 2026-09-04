import { json } from '@sveltejs/kit';
import { databasePath, getDb } from '$lib/server/db';

export function GET() {
  getDb().prepare('SELECT 1').get();
  return json({ ok: true, service: 'oa-order-sveltekit', database: 'sqlite', database_path: databasePath, time: new Date().toISOString() });
}
