import type { ArtifactVisitor } from '$lib/artifact-visitor';
import { getOrderDb } from '$lib/server/order-db';

export const ADMIN_UID = 826;
export const ADMIN_USERNAME = 'catsco';
export const departments = ['商务', '内务', '策划', '设计', '执行'] as const;
export const employeeRoles = ['executor', 'designer', 'planner', 'manager', 'finance', 'owner'] as const;
export type EmployeeRole = typeof employeeRoles[number];
export type Employee = {
  catsco_uid: number;
  username: string;
  display_name: string;
  department: string;
  role: EmployeeRole | 'pending';
  active: number;
};
export type CurrentIdentity = { uid: number; username: string; displayName: string; role: 'admin' | EmployeeRole | 'pending'; department: string; active: boolean };
export const IDENTITY_SWITCH_COOKIE = 'oa-admin-identity';

export function createIdentitySwitchToken(uid: number, role: EmployeeRole | 'admin') {
  return `${uid}:${role}`;
}

function readIdentitySwitchUid(cookieHeader: string) {
  const value = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${IDENTITY_SWITCH_COOKIE}=`))?.slice(IDENTITY_SWITCH_COOKIE.length + 1);
  if (!value) return null;
  const [uidText, role] = value.split(':');
  if (!uidText || !role || !/^\d+$/.test(uidText) || !([...employeeRoles, 'admin'] as string[]).includes(role)) return null;
  return { uid: Number(uidText), role: role as EmployeeRole | 'admin' };
}

export function resolveIdentity(visitor: ArtifactVisitor): CurrentIdentity | null {
  if (visitor.status !== 'authenticated') return null;
  const { uid, username } = visitor.viewer;
  // 管理员是固定的 Catsco 开发人员身份，不存入员工角色表，也不能由管理页面授予。
  if (uid === ADMIN_UID && username.toLowerCase() === ADMIN_USERNAME) {
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
  return { uid, username, displayName: employee.display_name, role: employee.role, department: employee.department, active: employee.active === 1 };
}

export function resolveActingIdentity(visitor: ArtifactVisitor, cookieHeader: string): CurrentIdentity | null {
  const admin = resolveIdentity(visitor);
  if (!admin || admin.role !== 'admin') return admin;
  const selected = readIdentitySwitchUid(cookieHeader);
  if (!selected || selected.role === 'admin') return admin;
  if (selected.uid === ADMIN_UID) return { ...admin, role: selected.role, displayName: `${admin.displayName}（${selected.role}）` };
  const employee = getOrderDb().prepare('SELECT * FROM employees WHERE catsco_uid=? AND active=1').get(selected.uid) as Employee | undefined;
  if (!employee || employee.role !== selected.role) return admin;
  return { uid: employee.catsco_uid, username: employee.username, displayName: employee.display_name, role: employee.role, department: employee.department, active: employee.active === 1 };
}

export function listIdentitySwitchOptions() {
  const adminOptions = employeeRoles.map((role) => ({ catsco_uid: ADMIN_UID, display_name: `catsco（${role}）`, department: '系统调试', role }));
  return [...adminOptions, ...listActiveEmployees()];
}

export function listActiveEmployees(): Pick<Employee, 'catsco_uid' | 'display_name' | 'department' | 'role'>[] {
  return getOrderDb().prepare("SELECT catsco_uid,display_name,department,role FROM employees WHERE active=1 ORDER BY department,display_name").all() as Pick<Employee, 'catsco_uid' | 'display_name' | 'department' | 'role'>[];
}

export function listEmployees(): Employee[] {
  return getOrderDb().prepare('SELECT catsco_uid,username,display_name,department,role,active FROM employees ORDER BY active,department,display_name').all() as Employee[];
}

export function updateEmployee(uid: number, input: { display_name: string; department: string; role: string; active: boolean }) {
  if (!Number.isSafeInteger(uid) || uid === ADMIN_UID) throw new Error('INVALID_EMPLOYEE');
  if (!employeeRoles.includes(input.role as EmployeeRole) && input.role !== 'pending') throw new Error('INVALID_ROLE');
  if (input.role === 'pending' && input.active) throw new Error('INVALID_ROLE');
  if (input.department && !departments.includes(input.department as typeof departments[number])) throw new Error('INVALID_DEPARTMENT');
  const db = getOrderDb();
  const exists = db.prepare('SELECT 1 FROM employees WHERE catsco_uid=?').get(uid);
  if (!exists) throw new Error('EMPLOYEE_NOT_FOUND');
  db.prepare('UPDATE employees SET display_name=?,department=?,role=?,active=?,updated_at=? WHERE catsco_uid=?')
    .run(input.display_name.trim() || '未命名员工', input.department, input.role, input.active ? 1 : 0, new Date().toISOString(), uid);
  return db.prepare('SELECT catsco_uid,username,display_name,department,role,active FROM employees WHERE catsco_uid=?').get(uid) as Employee;
}
