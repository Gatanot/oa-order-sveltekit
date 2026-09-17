import { listCatalog, listCatalogSources, listCustomers, listOrders, listProjects, listReimbursementOrders } from './order-db';

export function loadWorkbench() {
  return {
    customers: listCustomers(),
    projects: listProjects(),
    catalog: listCatalog(),
    catalogSources: listCatalogSources(),
    orders: listOrders(),
    reimbursements: listReimbursementOrders()
  };
}
