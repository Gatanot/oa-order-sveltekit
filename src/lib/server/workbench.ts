import { isDepartmentApprover, listCatalog, listCatalogSources, listCustomers, listExecutionCompanies, listOrders, listProjects, listReimbursementOrders, withReimbursementActions } from './order-db';
import { listActiveEmployees, orderViewAllRoles, reimbursementActionRoles, reimbursementViewAllRoles, catalogViewRoles, hasAnyRole, type CurrentIdentity } from './identity';
import { todayInBizTZ } from '$lib/server/time';

export function loadWorkbench(identity?: CurrentIdentity) {
  const allOrders = listOrders();
  const allReimbursements = listReimbursementOrders();
  const canViewAllOrders = !identity || hasAnyRole(identity, orderViewAllRoles);
  const canViewAllReimbursements = !identity || hasAnyRole(identity, reimbursementViewAllRoles);
  // 部门审核人即使没有审核角色，也可以进入审核页处理自己负责的节点。
  const canReviewReimbursements = !identity || hasAnyRole(identity, reimbursementActionRoles) || isDepartmentApprover(identity.uid);
  const identityUid = identity?.uid;
  const orders = canViewAllOrders ? allOrders : allOrders.filter((order) =>
    order.created_by_uid === identityUid || order.designer_uid === identityUid || order.planner_uid === identityUid
  );
  // “我的报销”始终只包含本人记录，审核者也一样。
  const reimbursements = !identity ? allReimbursements : allReimbursements.filter((item) => item.employee_uid === identityUid);
  // “报销审核”只展示当前身份在部门配置中负责的节点；审核者不能审自己的报销。
  const reviewReimbursements = canReviewReimbursements
    ? withReimbursementActions(allReimbursements, identity).filter((item) => item.can_act)
    : [];
  // “历史报销”是已完成（已执行）的全部报销单，仅对可见全部的审核角色开放。
  const historyReimbursements = canViewAllReimbursements
    ? allReimbursements.filter((item) => item.reimbursement_status === '已执行')
    : [];
  return {
    today: todayInBizTZ(),
    customers: listCustomers(),
    projects: listProjects(),
    employees: listActiveEmployees(),
    executionCompanies: listExecutionCompanies(),
    orders,
    reimbursements,
    reviewReimbursements,
    historyReimbursements,
    canReviewReimbursements,
    canViewAllReimbursements
  };
}

/**
 * 报价库/成本库单独加载：全量有近万条记录（明文数 MB），只有报价库页面和订单录入
 * 的报价/成本联想需要它。放在布局层会让每个页面都背上这份数据，首屏因此慢一个量级。
 */
export function loadCatalogSection(identity?: CurrentIdentity) {
  const canViewCatalog = !identity || hasAnyRole(identity, catalogViewRoles);
  return {
    catalog: canViewCatalog ? listCatalog() : { quote: [], cost: [] },
    catalogSources: canViewCatalog ? listCatalogSources() : []
  };
}
