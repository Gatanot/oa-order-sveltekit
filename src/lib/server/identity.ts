import type { ArtifactVisitor } from '$lib/artifact-visitor';
import { getOrderDb, isDepartmentApprover } from '$lib/server/order-db';
import { ADMIN_UID, ADMIN_UIDS, isAdminUid, departments, employeeRoleForDepartment, employeeRoles, reimbursementActionRoles, hasAnyRole, type EmployeeRole } from '$lib/permissions';

export { ADMIN_UID, ADMIN_UIDS, isAdminUid, departments, employeeRoles, employeeRoleForDepartment };
export type { EmployeeRole };
export const ADMIN_USERNAME = 'catsco';
export type Employee = {
  catsco_uid: number;
  username: string;
  display_name: string;
  department: string;
  role: EmployeeRole | 'pending';
  active: number;
};
export type CurrentIdentity = { uid: number; username: string; displayName: string; role: 'admin' | EmployeeRole | 'pending'; department: string; active: boolean };
export type AdminExtraIdentity = { role: EmployeeRole };

// 权限集合集中定义，避免页面和 API 各自维护一份角色列表。
export { orderViewAllRoles, orderManageRoles, orderExportRoles, orderCreateRoles, reimbursementViewAllRoles, reimbursementActionRoles, catalogViewRoles, catalogManageRoles, employeeManageRoles, executionCompanyManageRoles, hasAnyRole } from '$lib/permissions';

// 业务身份层级只用于员工管理授权判定：上级可管理下级，同级与更高级别不可互相管理。
// 部门即身份后，老板是唯一业务上级；pending/未知身份按最低级别处理。
const employeeRoleRanks: Record<EmployeeRole, number> = { executor: 1, designer: 1, business: 1, planner: 1, finance: 1, owner: 3 };

export function employeeRoleRank(role: string): number {
  return role in employeeRoleRanks ? employeeRoleRanks[role as EmployeeRole] : 0;
}

// admin 可管理除固定管理员外的所有员工；老板只能管理级别严格低于自己且非本人的员工，
// 因此老板无法修改自己的部门/身份，也无法管理其他老板。
export function canManageEmployee(actor: CurrentIdentity | null | undefined, target: { catsco_uid: number; role: string }): boolean {
  if (!actor || isAdminUid(target.catsco_uid)) return false;
  if (actor.role === 'admin') return true;
  if (actor.role !== 'owner') return false;
  if (target.catsco_uid === actor.uid) return false;
  return employeeRoleRank(target.role) < employeeRoleRank(actor.role);
}

export function getAdminExtraIdentity(uid: number = ADMIN_UID): AdminExtraIdentity | null {
  if (!isAdminUid(uid)) return null;
  const row = getOrderDb().prepare('SELECT role FROM system_admin_identity WHERE uid=?').get(uid) as { role: EmployeeRole } | undefined;
  return row ? { role: row.role } : null;
}

export function setAdminExtraIdentity(role: EmployeeRole | null, uid: number = ADMIN_UID) {
  if (!isAdminUid(uid)) throw new Error('FORBIDDEN');
  const db = getOrderDb();
  if (role === null) {
    db.prepare('DELETE FROM system_admin_identity WHERE uid=?').run(uid);
    return;
  }
  if (!employeeRoles.includes(role)) throw new Error('INVALID_ROLE');
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO system_admin_identity(uid,role,created_at,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(uid) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at`)
    .run(uid, role, timestamp, timestamp);
}

export function resolveIdentity(visitor: ArtifactVisitor): CurrentIdentity | null {
  if (visitor.status !== 'authenticated') return null;
  const { uid, username } = visitor.viewer;
  // 固定系统管理员名单（826、406）不存入员工角色表，也不能由管理页面授予或修改。
  if (isAdminUid(uid)) {
    return { uid, username, displayName: username, role: 'admin', department: '', active: true };
  }
  const db = getOrderDb();
  const employee = db.prepare('SELECT * FROM employees WHERE catsco_uid=?').get(uid) as Employee | undefined;
  if (!employee) {
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO employees(catsco_uid,username,display_name,role,active,created_at,updated_at) VALUES(?,?,?,\'pending\',0,?,?)').run(uid, username, username, timestamp, timestamp);
    return { uid, username, displayName: username, role: 'pending', department: '', active: false };
  }
  if (employee.username !== username) {
    db.prepare('UPDATE employees SET username=?,updated_at=? WHERE catsco_uid=?').run(username, new Date().toISOString(), uid);
  }
  // 身份始终由部门推导；若历史数据不一致，顺带把 role 缓存同步为部门身份。
  const role = employeeRoleForDepartment(employee.department);
  if (employee.role !== role) {
    db.prepare('UPDATE employees SET role=?,active=?,updated_at=? WHERE catsco_uid=?').run(role, role === 'pending' ? 0 : 1, new Date().toISOString(), uid);
  }
  return { uid, username, displayName: employee.display_name, role, department: employee.department, active: role !== 'pending' };
}

export function resolveActingIdentity(visitor: ArtifactVisitor): CurrentIdentity | null {
  const admin = resolveIdentity(visitor);
  if (!admin || admin.role !== 'admin') return admin;
  const extra = getAdminExtraIdentity(admin.uid);
  return extra ? { ...admin, role: extra.role, displayName: `${admin.displayName}（${extra.role}）` } : admin;
}

export function listActiveEmployees(): Pick<Employee, 'catsco_uid' | 'display_name' | 'department' | 'role'>[] {
  // 已录入并分配身份的员工的直接可用，不再额外区分启用/停用。
  return getOrderDb().prepare("SELECT catsco_uid,display_name,department,role FROM employees WHERE role<>'pending' ORDER BY department,display_name").all() as Pick<Employee, 'catsco_uid' | 'display_name' | 'department' | 'role'>[];
}

/** 按 UID 读取员工档案姓名，订单展示与写入统一使用该姓名而非登录用户名。 */
export function getEmployeeDisplayName(uid: number): string | null {
  const row = getOrderDb().prepare('SELECT display_name FROM employees WHERE catsco_uid=?').get(uid) as { display_name: string } | undefined;
  return row?.display_name?.trim() || null;
}

/** 审核入口：固定角色或部门配置的审核人都可进入，具体节点仍由报销记录逐条判定。 */
export function canUseReimbursementReview(identity: CurrentIdentity | null | undefined): boolean {
  if (!identity) return false;
  return hasAnyRole(identity, reimbursementActionRoles) || isDepartmentApprover(identity.uid);
}

export function listEmployees(): Employee[] {
  return getOrderDb().prepare('SELECT catsco_uid,username,display_name,department,role,active FROM employees ORDER BY department,display_name').all() as Employee[];
}

/** 员工身份由部门唯一决定；空部门或未知部门即待开通。 */
export function updateEmployee(uid: number, input: { display_name: string; department: string }) {
  if (!Number.isSafeInteger(uid) || isAdminUid(uid)) throw new Error('INVALID_EMPLOYEE');
  const department = input.department.trim();
  if (department && !departments.includes(department as typeof departments[number])) throw new Error('INVALID_DEPARTMENT');
  const role = employeeRoleForDepartment(department);
  const db = getOrderDb();
  const exists = db.prepare('SELECT 1 FROM employees WHERE catsco_uid=?').get(uid);
  if (!exists) throw new Error('EMPLOYEE_NOT_FOUND');
  db.prepare('UPDATE employees SET display_name=?,department=?,role=?,active=?,updated_at=? WHERE catsco_uid=?')
    .run(input.display_name.trim() || '未命名员工', role === 'pending' ? '' : department, role, role === 'pending' ? 0 : 1, new Date().toISOString(), uid);
  return db.prepare('SELECT catsco_uid,username,display_name,department,role,active FROM employees WHERE catsco_uid=?').get(uid) as Employee;
}
