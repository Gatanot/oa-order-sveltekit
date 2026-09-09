import type { PageServerLoad } from './$types';
import { listCatalog, listCustomers, listOrders, listProjects } from '$lib/server/order-db';

export const load: PageServerLoad = () => ({
  customers: listCustomers(),
  projects: listProjects(),
  catalog: listCatalog(),
  orders: listOrders()
});
