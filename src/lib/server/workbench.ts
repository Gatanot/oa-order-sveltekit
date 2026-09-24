import { listCatalog, listCatalogSources, listCustomers, listOrders, listProjects, listReimbursementOrders } from './order-db';
import { listActiveEmployees, type CurrentIdentity } from './identity';

export function loadWorkbench(identity?: CurrentIdentity) {
  const allOrders = listOrders();
  const allReimbursements = listReimbursementOrders();
  const canViewAllOrders = !identity || ['admin', 'manager', 'owner'].includes(identity.role);
  const canViewAllReimbursements = !identity || ['admin', 'manager', 'owner', 'finance'].includes(identity.role);
  const orders = canViewAllOrders ? allOrders : allOrders.filter((order) =>
    order.created_by_uid === identity.uid || order.designer_uid === identity.uid || order.planner_uid === identity.uid
  );
  const reimbursements = canViewAllReimbursements ? allReimbursements : allReimbursements.filter((item) => item.employee_uid === identity.uid);
  return {
    customers: listCustomers(),
    projects: listProjects(),
    catalog: listCatalog(),
    catalogSources: listCatalogSources(),
    employees: listActiveEmployees(),
    orders,
    reimbursements
  };
}
