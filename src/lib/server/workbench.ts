import { listCatalog, listCatalogSources, listCustomers, listOrders, listProjects, listReimbursementOrders } from './order-db';
import { ADMIN_UID, listActiveEmployees, orderViewAllRoles, reimbursementViewAllRoles, hasAnyRole, type CurrentIdentity } from './identity';
import { reimbursementStatusesForRole } from '$lib/permissions';

export function loadWorkbench(identity?: CurrentIdentity) {
  const allOrders = listOrders();
  const allReimbursements = listReimbursementOrders();
  const canViewAllOrders = !identity || hasAnyRole(identity, orderViewAllRoles);
  const canViewAllReimbursements = !identity || hasAnyRole(identity, reimbursementViewAllRoles);
  const identityUid = identity?.uid;
  const orders = canViewAllOrders ? allOrders : allOrders.filter((order) =>
    order.created_by_uid === identityUid || order.designer_uid === identityUid || order.planner_uid === identityUid
  );
  // “我的报销”始终只包含本人记录，审核者也一样。
  const reimbursements = !identity ? allReimbursements : allReimbursements.filter((item) => item.employee_uid === identityUid);
  // “报销审核”是按角色审批节点裁剪的队列；固定管理员可见全部，其他审核者不能审自己的报销。
  const responsibleStatuses = identity ? reimbursementStatusesForRole(identity.role) : null;
  const reviewReimbursements = canViewAllReimbursements && responsibleStatuses
    ? allReimbursements.filter((item) =>
        responsibleStatuses.includes(item.reimbursement_status) &&
        (identityUid === ADMIN_UID || item.employee_uid !== identityUid)
      )
    : [];
  return {
    customers: listCustomers(),
    projects: listProjects(),
    catalog: listCatalog(),
    catalogSources: listCatalogSources(),
    employees: listActiveEmployees(),
    orders,
    reimbursements,
    reviewReimbursements
  };
}
