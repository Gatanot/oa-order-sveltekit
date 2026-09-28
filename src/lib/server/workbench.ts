import { listCatalog, listCatalogSources, listCustomers, listOrders, listProjects, listReimbursementOrders } from './order-db';
import { listActiveEmployees, orderViewAllRoles, reimbursementViewAllRoles, hasAnyRole, type CurrentIdentity } from './identity';

export function loadWorkbench(identity?: CurrentIdentity) {
  const allOrders = listOrders();
  const allReimbursements = listReimbursementOrders();
  const canViewAllOrders = !identity || hasAnyRole(identity, orderViewAllRoles);
  const canViewAllReimbursements = !identity || hasAnyRole(identity, reimbursementViewAllRoles);
  const identityUid = identity?.uid;
  const orders = canViewAllOrders ? allOrders : allOrders.filter((order) =>
    order.created_by_uid === identityUid || order.designer_uid === identityUid || order.planner_uid === identityUid
  );
  const reimbursements = canViewAllReimbursements ? allReimbursements : allReimbursements.filter((item) => item.employee_uid === identityUid);
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
