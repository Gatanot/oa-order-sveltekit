import type { PageServerLoad } from './$types';
import { listCatalog, listCustomers, listOrders, listProjects, listReimbursementOrders } from '$lib/server/order-db';

export const load: PageServerLoad = () => ({
  customers: listCustomers(),
  projects: listProjects(),
  catalog: listCatalog(),
  orders: listOrders(),
  reimbursements: listReimbursementOrders()
});
