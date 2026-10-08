import { listCatalog, listCatalogSources, listCustomers, listOrders, listProjects, listReimbursementOrders } from './order-db';
import { ADMIN_UID, listActiveEmployees, orderViewAllRoles, reimbursementViewAllRoles, catalogViewRoles, hasAnyRole, type CurrentIdentity } from './identity';
import { reimbursementStatusesForRole } from '$lib/permissions';

export function loadWorkbench(identity?: CurrentIdentity) {
  const allOrders = listOrders();
  const allReimbursements = listReimbursementOrders();
  const canViewAllOrders = !identity || hasAnyRole(identity, orderViewAllRoles);
  const canViewAllReimbursements = !identity || hasAnyRole(identity, reimbursementViewAllRoles);
  const canViewCatalog = !identity || hasAnyRole(identity, catalogViewRoles);
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
  // “历史报销”是已完成（已执行）的全部报销单，仅对可见全部的审核角色开放。
  const historyReimbursements = canViewAllReimbursements
    ? allReimbursements.filter((item) => item.reimbursement_status === '已执行')
    : [];
  return {
    customers: listCustomers(),
    projects: listProjects(),
    catalog: canViewCatalog ? listCatalog() : [],
    catalogSources: canViewCatalog ? listCatalogSources() : [],
    employees: listActiveEmployees(),
    orders,
    reimbursements,
    reviewReimbursements,
    historyReimbursements
  };
}
