<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { ArrowRight, CircleCheck, Info, Pencil, Plus, Save, Search, ShieldCheck, Trash2, X } from 'lucide-svelte';
  import { api } from '$lib/api';
  import WorkbenchListFilters from '../WorkbenchListFilters.svelte';

  const desk = getContext<any>('order-desk');

  type EmployeeRow = {
    catsco_uid: number;
    username: string;
    display_name: string;
    department: string;
    role: string;
    active: number | boolean;
    isSelf?: boolean;
    canManage?: boolean;
  };
  type EmployeeDraft = { display_name: string; department: string; role: string; active: boolean };
  type ApproverUser = { employee_uid: number; display_name: string; username: string; role: string };
  type DepartmentApproverConfig = {
    departments: string[];
    layers: Array<{ layer: number; status: string; defaultRoles: string[] }>;
    approvers: Record<string, Record<string, ApproverUser[]>>;
  };
  type ApproverLayerDraft = { '1': number[]; '2': number[]; '3': number[] };
  type ExecutionCompany = { id: string; name: string; sort_order?: number; created_at?: string; updated_at?: string };
  type RoleMeta = { label: string; summary: string; permissions: string[] };

  const canManageEmployees = $derived(Boolean(desk.canManageEmployees));
  const canManageExecutionCompanies = $derived(Boolean(desk.canManageExecutionCompanies));
  const currentRole = $derived(String(desk.identity?.role || ''));

  const roleLabels: Record<string, string> = {
    pending: '待开通',
    executor: '执行',
    designer: '设计师',
    planner: '策划',
    manager: '管理人员',
    finance: '财务',
    owner: '老板'
  };
  const roleMeta: Record<string, RoleMeta> = {
    owner: {
      label: '老板',
      summary: '全局经营数据与最终确认',
      permissions: ['查看、管理并导出全部订单', '确认报销、查看历史报销', '管理员工权限与执行公司']
    },
    manager: {
      label: '管理人员',
      summary: '订单管理与团队日常管理',
      permissions: ['查看、管理并导出全部订单', '审核报销、维护报价成本库', '管理下级员工（不能授予管理、财务或老板身份）']
    },
    finance: {
      label: '财务',
      summary: '订单查看与报销处理',
      permissions: ['查看全部订单并导出', '复核、执行报销并查看历史报销']
    },
    executor: {
      label: '执行',
      summary: '订单执行与资料库维护',
      permissions: ['新建、编辑本人创建的订单并导出', '查看和维护报价库与成本库', '管理执行公司']
    },
    designer: {
      label: '设计师',
      summary: '处理本人参与的订单',
      permissions: ['查看本人创建或参与的订单', '提交并查看本人报销']
    },
    planner: {
      label: '策划',
      summary: '处理本人参与的订单',
      permissions: ['查看本人创建或参与的订单', '提交并查看本人报销']
    },
    pending: {
      label: '待开通',
      summary: '尚未分配业务身份，不能进入业务功能',
      permissions: ['请先设置员工身份并启用账号']
    }
  };
  const guideRoles = ['owner', 'manager', 'finance', 'executor', 'designer', 'planner', 'pending'];
  const approverLayers = [
    { layer: 1 as const, label: '一级审核' },
    { layer: 2 as const, label: '二级审核' },
    { layer: 3 as const, label: '三级审核' }
  ];

  function roleInfo(role: string): RoleMeta {
    return roleMeta[role] || { label: roleLabels[role] || role, summary: '自定义业务身份', permissions: [] };
  }
  function roleLabel(role: string) {
    return roleInfo(role).label;
  }
  function openRoleGuide(role = '') {
    roleGuideOpen = true;
    roleGuideFocusRole = role;
    roleGuideQuery = role ? roleInfo(role).label : '';
  }
  function closeRoleGuide() {
    if (roleGuideOpen) roleGuideOpen = false;
  }
  function showAllRoles() {
    roleGuideQuery = '';
    roleGuideFocusRole = '';
  }
  function filterByRole(role: string) {
    filters = { ...filters, role, active: '' };
    roleGuideOpen = false;
  }
  function setStatFilter(kind: 'all' | 'enabled' | 'pending' | 'disabled') {
    if (kind === 'all') filters = { ...filters, role: '', active: '' };
    else if (kind === 'pending') filters = { ...filters, role: 'pending', active: '' };
    else filters = { ...filters, role: '', active: kind };
  }
  function employeeStatus(employee: EmployeeRow) {
    if (employee.role === 'pending') return { label: '待开通', tone: 'pending' };
    return Boolean(employee.active)
      ? { label: '已启用', tone: 'enabled' }
      : { label: '已停用', tone: 'disabled' };
  }

  // ── 员工管理 ──────────────────────────────────────────────────
  let employees = $state<EmployeeRow[]>([]);
  let savedEmployees = $state<EmployeeRow[]>([]);
  let departments = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let employeeError = $state('');
  let employeeSuccess = $state('');
  let loadingEmployees = $state(Boolean(desk.canManageEmployees));
  let approverConfig = $state<DepartmentApproverConfig | null>(null);
  let approverDraft = $state<Record<string, ApproverLayerDraft>>({});
  let approverSaving = $state('');
  let approverError = $state('');
  let approverSuccess = $state('');
  let approverEditorDepartment = $state('');
  let savingEmployee = $state(false);
  let creatingEmployee = $state(false);
  let editingUid = $state<number | null>(null);
  let draft = $state<EmployeeDraft | null>(null);
  let filters = $state({ search: '', department: '', role: '', active: '' });
  let roleGuideOpen = $state(false);
  let roleGuideQuery = $state('');
  let roleGuideFocusRole = $state('');
  let roleGuideSearchInput = $state<HTMLInputElement>();
  let approverSearch = $state('');

  let createOpen = $state(false);
  let newUid = $state('');
  let newUsername = $state('');
  let newName = $state('');
  let newDepartment = $state('');
  let newRole = $state('pending');

  // 统计口径只跟随搜索与部门，身份/启用状态作为快捷筛选，避免点击后数量归零。
  const baseEmployees = $derived(savedEmployees.filter((employee) =>
    (!filters.search || `${employee.display_name} ${employee.username} ${employee.catsco_uid}`.toLowerCase().includes(filters.search.trim().toLowerCase())) &&
    (!filters.department || employee.department === filters.department)
  ));
  const matchingEmployeeIds = $derived(new Set(baseEmployees.filter((employee) =>
    (!filters.role || employee.role === filters.role) &&
    (!filters.active || (filters.active === 'enabled'
      ? Boolean(employee.active) && employee.role !== 'pending'
      : !Boolean(employee.active) && employee.role !== 'pending'))
  ).map((employee) => employee.catsco_uid)));
  const visibleEmployees = $derived(employees.filter((employee) => matchingEmployeeIds.has(employee.catsco_uid)));
  const visibleDepartments = $derived(new Set(visibleEmployees.map((employee) => employee.department).filter(Boolean)));
  const statCounts = $derived({
    total: baseEmployees.length,
    enabled: baseEmployees.filter((employee) => Boolean(employee.active) && employee.role !== 'pending').length,
    pending: baseEmployees.filter((employee) => employee.role === 'pending').length,
    disabled: baseEmployees.filter((employee) => !Boolean(employee.active) && employee.role !== 'pending').length
  });
  const roleCounts = $derived(employees.reduce<Record<string, number>>((counts, employee) => {
    counts[employee.role] = (counts[employee.role] || 0) + 1;
    return counts;
  }, {}));
  const guideQueryText = $derived(roleGuideQuery.trim().toLowerCase());
  const guideRoleEntries = $derived(guideRoles.filter((role) => {
    if (!guideQueryText) return true;
    const info = roleInfo(role);
    return `${info.label} ${info.summary} ${info.permissions.join(' ')}`.toLowerCase().includes(guideQueryText);
  }));
  const hasActiveFilters = $derived(filters.search !== '' || filters.department !== '' || filters.role !== '' || filters.active !== '');
  // 审核人候选取启用中的正式员工；任意部门员工都可以被配置为其他部门的审核人。
  const approverCandidates = $derived(employees
    .filter((employee) => Boolean(employee.active) && employee.role !== 'pending')
    .sort((a, b) => a.department.localeCompare(b.department, 'zh-CN') || a.display_name.localeCompare(b.display_name, 'zh-CN')));
  const approverSearchText = $derived(approverSearch.trim().toLowerCase());

  // 当前操作者可授予的身份；管理人员不能授予管理、财务或老板身份。
  const assignableRoles = $derived.by(() => {
    const available = roles.length ? roles : ['executor', 'designer', 'planner', 'manager', 'finance', 'owner'];
    if (currentRole === 'admin') return ['pending', ...available];
    if (currentRole === 'owner') return ['pending', ...available.filter((role) => role !== 'owner')];
    if (currentRole === 'manager') return ['pending', ...available.filter((role) => !['owner', 'manager', 'finance'].includes(role))];
    return ['pending'];
  });
  const roleAssignHint = $derived.by(() => {
    if (currentRole === 'admin') return '可授予全部业务身份。';
    if (currentRole === 'owner') return '可授予除老板外的身份；固定账号不可修改。';
    if (currentRole === 'manager') return '可授予执行、设计、策划或待开通；不可授予管理、财务、老板。';
    return '当前身份不能调整员工身份。';
  });

  const filterFields = $derived([
    { key: 'search', label: '搜索', type: 'search' as const, value: filters.search, placeholder: '姓名 / 用户名 / 用户编号' },
    { key: 'department', label: '部门', value: filters.department, options: [{ value: '', label: '全部部门' }, ...departments.map((value) => ({ value, label: value }))] },
    { key: 'role', label: '身份', value: filters.role, options: [{ value: '', label: '全部身份' }, { value: 'pending', label: '待开通' }, ...roles.map((value) => ({ value, label: roleLabels[value] || value }))] },
    { key: 'active', label: '启用状态', value: filters.active, options: [{ value: '', label: '全部状态' }, { value: 'enabled', label: '已启用' }, { value: 'disabled', label: '已停用' }] }
  ]);

  function roleOptionsFor(employee: EmployeeRow) {
    return assignableRoles.includes(employee.role)
      ? assignableRoles
      : [employee.role, ...assignableRoles.filter((role) => role !== employee.role)];
  }
  function canEditProfile(employee: EmployeeRow) {
    return Boolean(employee.canManage || employee.isSelf);
  }
  function canEditRole(employee: EmployeeRow) {
    return Boolean(employee.canManage);
  }
  function draftDirty(employee: EmployeeRow) {
    return Boolean(draft) && (
      draft!.display_name !== employee.display_name ||
      draft!.department !== employee.department ||
      draft!.role !== employee.role ||
      draft!.active !== Boolean(employee.active)
    );
  }
  function syncDeskEmployees() {
    // 订单录入只使用启用中的员工，资料保存后同步，避免必须刷新页面。
    try {
      desk.employees = employees
        .filter((employee) => Boolean(employee.active) && employee.role !== 'pending')
        .map(({ catsco_uid, display_name, department, role }) => ({ catsco_uid, display_name, department, role }));
    } catch {
      // 兼容旧工作台状态对象：订单页重新加载时仍会取到最新员工。
    }
  }
  async function fetchEmployees() {
    const result = await api.get<{ data: EmployeeRow[]; departments: string[]; roles: string[] }>('/api/employees');
    employees = result.data;
    savedEmployees = result.data.map((employee) => ({ ...employee }));
    departments = result.departments;
    roles = result.roles;
    syncDeskEmployees();
  }
  async function loadEmployees() {
    loadingEmployees = true;
    employeeError = '';
    try {
      await fetchEmployees();
    } catch (reason) {
      employeeError = reason instanceof Error ? reason.message : '员工列表加载失败';
    } finally {
      loadingEmployees = false;
    }
  }

  // ── 报销三级审批设置 ──────────────────────────────────────────
  function emptyLayerDraft(): ApproverLayerDraft {
    return { '1': [], '2': [], '3': [] };
  }
  function departmentDraftFrom(config: DepartmentApproverConfig, department: string): ApproverLayerDraft {
    const layerDraft = emptyLayerDraft();
    for (const layer of ['1', '2', '3'] as const) {
      layerDraft[layer] = (config.approvers?.[department]?.[layer] || []).map((approver) => Number(approver.employee_uid));
    }
    return layerDraft;
  }
  function applyApproverConfig(config: DepartmentApproverConfig) {
    approverConfig = config;
    const draft: Record<string, ApproverLayerDraft> = {};
    for (const department of config.departments) draft[department] = departmentDraftFrom(config, department);
    approverDraft = draft;
  }
  async function loadApproverConfig() {
    try {
      const result = await api.get<{ data: DepartmentApproverConfig }>('/api/department-approvers');
      applyApproverConfig(result.data);
    } catch (reason) {
      approverError = reason instanceof Error ? reason.message : '审批设置加载失败';
    }
  }
  function approverIds(department: string, layer: 1 | 2 | 3) {
    return approverDraft[department]?.[String(layer) as '1' | '2' | '3'] || [];
  }
  function savedApprovers(department: string, layer: 1 | 2 | 3) {
    return approverConfig?.approvers?.[department]?.[String(layer)] || [];
  }
  function approverNames(department: string, layer: 1 | 2 | 3) {
    return savedApprovers(department, layer).map((approver) => approver.display_name || approver.username);
  }
  function defaultApproverHint(layer: 1 | 2 | 3) {
    const roles = approverConfig?.layers.find((item) => item.layer === layer)?.defaultRoles || [];
    if (!roles.length) return '使用默认角色';
    return `默认：${roles.map((role) => role === 'admin' ? '系统管理员' : roleLabel(role)).join('、')}`;
  }
  function approverSummary(department: string, layer: 1 | 2 | 3) {
    const names = approverNames(department, layer);
    if (!names.length) return '默认';
    return names.length > 2 ? `${names.slice(0, 2).join('、')} +${names.length - 2}` : names.join('、');
  }
  function approverTitle(department: string, layer: 1 | 2 | 3) {
    const names = approverNames(department, layer);
    return names.length ? names.join('、') : defaultApproverHint(layer);
  }
  function approverEmployeeRows(department: string) {
    const selected = new Set<number>();
    for (const { layer } of approverLayers) {
      for (const uid of approverIds(department, layer)) selected.add(uid);
    }
    const selectedEmployees = employees.filter((employee) => selected.has(employee.catsco_uid));
    const found = new Set(selectedEmployees.map((employee) => employee.catsco_uid));
    const missingSelected: EmployeeRow[] = [];
    for (const uid of selected) {
      if (found.has(uid)) continue;
      let approver: ApproverUser | undefined;
      for (const { layer } of approverLayers) {
        approver = savedApprovers(department, layer).find((item) => Number(item.employee_uid) === uid);
        if (approver) break;
      }
      if (approver) {
        missingSelected.push({ catsco_uid: uid, username: approver.username, display_name: approver.display_name, department: '', role: approver.role, active: false });
      }
    }
    const otherCandidates = approverCandidates.filter((employee) => !selected.has(employee.catsco_uid)
      && (!approverSearchText || `${employee.display_name} ${employee.username} ${employee.department}`.toLowerCase().includes(approverSearchText)));
    return [...selectedEmployees, ...missingSelected, ...otherCandidates]
      .sort((a, b) => a.department.localeCompare(b.department, 'zh-CN')
        || a.display_name.localeCompare(b.display_name, 'zh-CN'));
  }
  function approverDirty(department: string) {
    for (const layer of ['1', '2', '3'] as const) {
      const saved = (approverConfig?.approvers?.[department]?.[layer] || []).map((approver) => Number(approver.employee_uid)).sort((a, b) => a - b);
      const current = [...approverIds(department, Number(layer) as 1 | 2 | 3)].sort((a, b) => a - b);
      if (saved.length !== current.length || saved.some((uid, index) => uid !== current[index])) return true;
    }
    return false;
  }
  function approverConfigured(department: string) {
    return approverLayers.some(({ layer }) => approverNames(department, layer).length > 0);
  }
  function openApproverEditor(department: string) {
    approverError = '';
    approverSuccess = '';
    approverSearch = '';
    approverDraft = {
      ...approverDraft,
      [department]: approverConfig ? departmentDraftFrom(approverConfig, department) : emptyLayerDraft()
    };
    approverEditorDepartment = department;
  }
  async function closeApproverEditor() {
    if (approverSaving) return;
    if (approverEditorDepartment && approverDirty(approverEditorDepartment)
      && !await desk.requestConfirm('放弃未保存修改', '审批设置尚未保存，确定关闭吗？')) return;
    approverEditorDepartment = '';
    approverSearch = '';
    approverError = '';
  }
  function toggleApprover(department: string, layer: 1 | 2 | 3, uid: number, checked: boolean) {
    const current = approverIds(department, layer);
    const next = checked ? [...new Set([...current, uid])] : current.filter((value) => value !== uid);
    approverDraft = {
      ...approverDraft,
      [department]: {
        ...(approverDraft[department] || emptyLayerDraft()),
        [layer]: next
      }
    };
    approverError = '';
    approverSuccess = '';
  }
  async function saveDepartmentApprovers(department: string) {
    if (approverSaving) return;
    approverSaving = department;
    approverError = '';
    approverSuccess = '';
    try {
      const result = await api.patch<{ data: DepartmentApproverConfig }>('/api/department-approvers', {
        department,
        layers: approverDraft[department] || emptyLayerDraft()
      });
      approverConfig = result.data;
      approverDraft = { ...approverDraft, [department]: departmentDraftFrom(result.data, department) };
      approverEditorDepartment = '';
      approverSearch = '';
      approverSuccess = `已保存${department}的三级审批设置`;
    } catch (reason) {
      approverError = reason instanceof Error ? reason.message : '审批设置保存失败';
    } finally {
      approverSaving = '';
    }
  }
  function clearFilters() {
    filters = { search: '', department: '', role: '', active: '' };
  }
  function resetNewEmployee() {
    newUid = '';
    newUsername = '';
    newName = '';
    newDepartment = '';
    newRole = 'pending';
  }
  function startCreate() {
    employeeError = '';
    employeeSuccess = '';
    resetNewEmployee();
    createOpen = true;
  }
  function closeCreate() {
    if (creatingEmployee) return;
    createOpen = false;
    employeeError = '';
  }
  function changeDraftRole(role: string) {
    if (!draft) return;
    draft.role = role;
    if (role === 'pending') draft.active = false;
  }
  async function startEdit(employee: EmployeeRow) {
    if (editingUid === employee.catsco_uid) return;
    if (editingUid !== null && draft) {
      const current = employees.find((item) => item.catsco_uid === editingUid);
      if (current && draftDirty(current) && !await desk.requestConfirm('放弃未保存修改', '当前员工有未保存的修改，确定切换编辑对象吗？')) return;
    }
    employeeError = '';
    employeeSuccess = '';
    editingUid = employee.catsco_uid;
    draft = {
      display_name: employee.display_name,
      department: employee.department,
      role: employee.role,
      active: Boolean(employee.active)
    };
  }
  async function cancelEdit(employee: EmployeeRow) {
    if (savingEmployee) return;
    if (draftDirty(employee) && !await desk.requestConfirm('放弃未保存修改', `确定放弃对 ${employee.display_name || employee.username} 的修改吗？`)) return;
    editingUid = null;
    draft = null;
    employeeError = '';
  }
  async function saveDraft(employee: EmployeeRow) {
    if (savingEmployee || !draft) return;
    if (!draft.display_name.trim()) {
      employeeError = '员工姓名不能为空';
      return;
    }
    const savedName = draft.display_name.trim() || employee.display_name || employee.username;
    savingEmployee = true;
    employeeError = '';
    employeeSuccess = '';
    try {
      await api.patch('/api/employees', {
        uid: Number(employee.catsco_uid),
        display_name: draft.display_name.trim(),
        department: draft.department,
        role: draft.role,
        active: draft.role === 'pending' ? false : draft.active
      });
      await fetchEmployees();
      editingUid = null;
      draft = null;
      employeeSuccess = `已保存 ${savedName} 的资料`;
    } catch (reason) {
      employeeError = reason instanceof Error ? reason.message : '员工保存失败';
    } finally {
      savingEmployee = false;
    }
  }
  async function addEmployee() {
    if (creatingEmployee) return;
    const uid = Number(newUid);
    if (!Number.isSafeInteger(uid) || uid <= 0) {
      employeeError = '请输入有效的 Catsco 用户编号';
      return;
    }
    if (!newUsername.trim()) {
      employeeError = '请输入用户名';
      return;
    }
    creatingEmployee = true;
    employeeError = '';
    employeeSuccess = '';
    try {
      await api.post('/api/employees', {
        uid,
        username: newUsername.trim(),
        display_name: newName.trim() || newUsername.trim(),
        department: newDepartment,
        role: newRole,
        active: newRole !== 'pending'
      });
      await fetchEmployees();
      createOpen = false;
      employeeSuccess = newRole === 'pending'
        ? '员工已新增，当前为待开通状态'
        : `员工已新增，并已启用为${roleLabel(newRole)}身份`;
      resetNewEmployee();
    } catch (reason) {
      employeeError = reason instanceof Error ? reason.message : '员工创建失败';
    } finally {
      creatingEmployee = false;
    }
  }
  async function deleteEmployee(employee: EmployeeRow) {
    if (!await desk.requestConfirm('删除员工', `确定删除员工 ${employee.display_name || employee.username}（UID ${employee.catsco_uid}）？此操作不可恢复。`)) return;
    employeeError = '';
    employeeSuccess = '';
    try {
      await api.delete('/api/employees', { uid: employee.catsco_uid });
      employees = employees.filter((item) => item.catsco_uid !== employee.catsco_uid);
      savedEmployees = savedEmployees.filter((item) => item.catsco_uid !== employee.catsco_uid);
      if (editingUid === employee.catsco_uid) {
        editingUid = null;
        draft = null;
      }
      syncDeskEmployees();
      employeeSuccess = `已删除员工 ${employee.display_name || employee.username}`;
    } catch (reason) {
      employeeError = reason instanceof Error ? reason.message : '员工删除失败';
    }
  }

  // ── 执行公司管理 ──────────────────────────────────────────────
  let executionCompanies = $state<ExecutionCompany[]>([]);
  let executionError = $state('');
  let executionSuccess = $state('');
  let loadingCompanies = $state(Boolean(desk.canManageExecutionCompanies));
  let companySaving = $state(false);
  let creatingCompany = $state(false);
  let newCompanyName = $state('');
  let editingCompanyId = $state('');
  let editingCompanyName = $state('');
  async function fetchExecutionCompanies() {
    const result = await api.get<{ data: ExecutionCompany[] }>('/api/execution-companies');
    executionCompanies = result.data;
    desk.setExecutionCompanies(result.data);
  }
  async function loadExecutionCompanies() {
    loadingCompanies = true;
    executionError = '';
    try {
      await fetchExecutionCompanies();
    } catch (reason) {
      executionError = reason instanceof Error ? reason.message : '执行公司加载失败';
    } finally {
      loadingCompanies = false;
    }
  }
  function startCreateCompany() {
    executionError = '';
    executionSuccess = '';
    newCompanyName = '';
    creatingCompany = true;
  }
  function cancelCreateCompany() {
    creatingCompany = false;
    newCompanyName = '';
    executionError = '';
  }
  function startEditCompany(company: ExecutionCompany) {
    executionError = '';
    executionSuccess = '';
    editingCompanyId = company.id;
    editingCompanyName = company.name;
  }
  function cancelEditCompany() {
    editingCompanyId = '';
    editingCompanyName = '';
  }
  async function createCompany() {
    const name = newCompanyName.trim();
    if (companySaving || !name) return;
    companySaving = true;
    executionError = '';
    executionSuccess = '';
    try {
      await api.post('/api/execution-companies', { name });
      await fetchExecutionCompanies();
      creatingCompany = false;
      newCompanyName = '';
      executionSuccess = '执行公司已新增';
    } catch (reason) {
      executionError = reason instanceof Error ? reason.message : '执行公司新增失败';
    } finally {
      companySaving = false;
    }
  }
  async function saveCompany(company: ExecutionCompany) {
    const name = editingCompanyName.trim();
    if (companySaving) return;
    if (!name) {
      executionError = '执行公司名称不能为空';
      return;
    }
    companySaving = true;
    executionError = '';
    executionSuccess = '';
    try {
      await api.patch('/api/execution-companies', { id: company.id, name });
      await fetchExecutionCompanies();
      cancelEditCompany();
      executionSuccess = '执行公司已保存';
    } catch (reason) {
      executionError = reason instanceof Error ? reason.message : '执行公司保存失败';
    } finally {
      companySaving = false;
    }
  }
  async function deleteCompany(company: ExecutionCompany) {
    if (companySaving) return;
    if (!await desk.requestConfirm('删除执行公司', `确定删除执行公司「${company.name}」？已使用该公司的历史订单不受影响。`)) return;
    companySaving = true;
    executionError = '';
    executionSuccess = '';
    try {
      await api.delete('/api/execution-companies', { id: company.id });
      executionCompanies = executionCompanies.filter((item) => item.id !== company.id);
      desk.setExecutionCompanies(executionCompanies);
      executionSuccess = '执行公司已删除';
    } catch (reason) {
      executionError = reason instanceof Error ? reason.message : '执行公司删除失败';
    } finally {
      companySaving = false;
    }
  }

  $effect(() => {
    if (!roleGuideOpen) return;
    // 移动端不主动聚焦搜索框，避免弹出键盘遮挡权限卡片。
    if (!window.matchMedia('(min-width: 761px)').matches) return;
    const timer = setTimeout(() => roleGuideSearchInput?.focus(), 30);
    return () => clearTimeout(timer);
  });

  onMount(async () => {
    if (canManageEmployees) {
      await loadEmployees();
      await loadApproverConfig();
    }
    if (canManageExecutionCompanies) await loadExecutionCompanies();
  });
</script>

<svelte:window onkeydown={(event) => {
  if (event.key !== 'Escape') return;
  if (roleGuideOpen) { closeRoleGuide(); return; }
  if (approverEditorDepartment) { closeApproverEditor(); return; }
  if (createOpen && !creatingEmployee) closeCreate();
}} />

<section class="page-section workbench-list-page employee-page">
  <div class="section-heading">
    <div>
      <p class="section-kicker">{canManageEmployees ? '员工权限' : '基础资料'}</p>
      <h2>{canManageEmployees ? '员工与权限管理' : '执行公司管理'}</h2>
    </div>
    {#if canManageEmployees}
      <div class="top-actions">
        <button class="outline-action" type="button" onclick={() => openRoleGuide()}><ShieldCheck size={16} />角色权限说明</button>
        <button class="primary-action" type="button" onclick={startCreate}><Plus size={16} />新增员工</button>
      </div>
    {/if}
  </div>

  {#if canManageEmployees}
    <section class="employee-admin">
      <WorkbenchListFilters
        fields={filterFields}
        onchange={(key, value) => filters[key as keyof typeof filters] = value}
        onclear={clearFilters}
        label="员工筛选"
      />

      <div class="workbench-statistics">
        <div class="workbench-statistics-head"><span aria-live="polite">当前结果 {visibleEmployees.length} 位 · {visibleDepartments.size} 个部门</span><span>点击数字筛选状态</span></div>
        <div class="summary-row" role="group" aria-label="按启用状态快捷筛选员工">
          <div><button type="button" class="employee-stat" class:is-active={!filters.role && !filters.active} aria-pressed={!filters.role && !filters.active} title="显示全部员工" onclick={() => setStatFilter('all')}><span>员工总数</span><b>{statCounts.total}</b></button></div>
          <div><button type="button" class="employee-stat" class:is-active={filters.active === 'enabled'} aria-pressed={filters.active === 'enabled'} title="只看已启用员工" onclick={() => setStatFilter('enabled')}><span>已启用</span><b>{statCounts.enabled}</b></button></div>
          <div><button type="button" class="employee-stat" class:is-active={filters.role === 'pending'} aria-pressed={filters.role === 'pending'} title="只看待开通员工" onclick={() => setStatFilter('pending')}><span>待开通</span><b>{statCounts.pending}</b></button></div>
          <div><button type="button" class="employee-stat" class:is-active={filters.active === 'disabled'} aria-pressed={filters.active === 'disabled'} title="只看已停用员工" onclick={() => setStatFilter('disabled')}><span>已停用</span><b>{statCounts.disabled}</b></button></div>
        </div>
      </div>

      {#if employeeError && !createOpen}<p class="employee-error" role="alert">{employeeError}</p>{/if}
      {#if employeeSuccess}<p class="employee-success" role="status">{employeeSuccess}</p>{/if}

      <div class="table-tools workbench-table-tools">
        <div class="order-table-heading"><h3>员工明细</h3><span class="filter-result">共 {visibleEmployees.length} 位</span></div>
      </div>

      <div class="employee-table-wrap">
        <table>
          <thead><tr><th>员工</th><th>用户编号</th><th>部门</th><th>身份 / 权限</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {#each visibleEmployees as employee (employee.catsco_uid)}
              {#if editingUid === employee.catsco_uid && draft}
                {@const roleOptions = roleOptionsFor(employee)}
                <tr class:employee-row-readonly={!canEditProfile(employee)}>
                  <td>
                    <input aria-label="员工姓名" maxlength="40" bind:value={draft.display_name} disabled={savingEmployee} />
                    {#if employee.isSelf}<span class="employee-self-tag">（我）</span>{/if}
                    {#if draftDirty(employee)}<span class="employee-dirty-tag">未保存</span>{/if}
                  </td>
                  <td>{employee.catsco_uid} · {employee.username}</td>
                  <td>
                    <select aria-label="所属部门" bind:value={draft.department} disabled={savingEmployee}>
                      <option value="">未设置</option>
                      {#if draft.department && !departments.includes(draft.department)}<option value={draft.department}>{draft.department}</option>{/if}
                      {#each departments as department}<option value={department}>{department}</option>{/each}
                    </select>
                  </td>
                  <td>
                    <select
                      aria-label="员工身份"
                      value={draft.role}
                      disabled={!canEditRole(employee) || savingEmployee}
                      onchange={(event) => changeDraftRole(event.currentTarget.value)}
                    >
                      {#each roleOptions as role}<option value={role}>{roleLabel(role)}</option>{/each}
                    </select>
                    <div class="employee-role-title">
                      <small class="employee-role-summary">{roleInfo(draft.role).summary}</small>
                      <button type="button" class="employee-role-info" title={`查看${roleInfo(draft.role).label}权限说明`} aria-label={`查看${roleInfo(draft.role).label}权限说明`} onclick={() => openRoleGuide(draft!.role)}><Info size={13} /></button>
                    </div>
                    {#if !canEditRole(employee)}<small class="employee-role-summary">不能修改自己的身份</small>{/if}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`启用员工 ${employee.display_name}`}
                      bind:checked={draft.active}
                      disabled={!canEditRole(employee) || savingEmployee || draft.role === 'pending'}
                    />
                    <small class="employee-role-summary">{draft.role === 'pending' ? '待开通' : draft.active ? '已启用' : '已停用'}</small>
                  </td>
                  <td>
                    <div class="employee-row-actions">
                      <button type="button" class="icon-control" title="保存" aria-label={`保存员工 ${employee.display_name}`} disabled={savingEmployee} onclick={() => saveDraft(employee)}><Save size={16} /></button>
                      <button type="button" class="icon-control" title="取消" aria-label={`取消编辑员工 ${employee.display_name}`} disabled={savingEmployee} onclick={() => cancelEdit(employee)}><X size={16} /></button>
                    </div>
                  </td>
                </tr>
              {:else}
                {@const info = roleInfo(employee.role)}
                {@const status = employeeStatus(employee)}
                <tr class:employee-row-readonly={!canEditProfile(employee)}>
                  <td><b>{employee.display_name || '未命名员工'}</b>{#if employee.isSelf}<span class="employee-self-tag">（我）</span>{/if}</td>
                  <td>{employee.catsco_uid} · {employee.username}</td>
                  <td>{#if employee.department}{employee.department}{:else}<span class="muted">未设置</span>{/if}</td>
                  <td>
                    <div class="employee-role-cell">
                      <div class="employee-role-title">
                        <b>{info.label}</b>
                        <button type="button" class="employee-role-info" title={`查看${info.label}权限说明`} aria-label={`查看${info.label}权限说明`} onclick={() => openRoleGuide(employee.role)}><Info size={13} /></button>
                      </div>
                      <small class="employee-role-summary" title={info.summary}>{info.summary}</small>
                    </div>
                  </td>
                  <td><span class="employee-state employee-state-{status.tone}">{status.label}</span></td>
                  <td>
                    <div class="employee-row-actions">
                      {#if canEditProfile(employee)}
                        <button type="button" class="icon-control" title="编辑" aria-label={`编辑员工 ${employee.display_name}`} onclick={() => startEdit(employee)}><Pencil size={16} /></button>
                      {/if}
                      {#if employee.canManage}
                        <button type="button" class="delete-action" title="删除" aria-label={`删除员工 ${employee.display_name}`} disabled={savingEmployee} onclick={() => deleteEmployee(employee)}><Trash2 size={16} /></button>
                      {/if}
                      {#if !employee.canManage && !employee.isSelf}
                        <span class="employee-locked" title="不能管理同级或更高级别的员工">无权限</span>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {:else}
              <tr>
                <td colspan="6">
                  <div class="empty-table">
                    {loadingEmployees ? '加载中...' : employees.length ? '没有符合筛选条件的员工。' : employeeError ? '员工列表加载失败。' : '暂无员工。'}
                    {#if !loadingEmployees && hasActiveFilters}<button class="outline-action" type="button" onclick={clearFilters}>清空筛选</button>{/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="employee-admin approver-admin">
      <div class="table-tools workbench-table-tools">
        <div class="order-table-heading"><h3>报销三级审批设置</h3><span class="filter-result">按报销人所属部门匹配</span></div>
      </div>
      {#if approverError && !approverEditorDepartment}<p class="employee-error" role="alert">{approverError}</p>{/if}
      {#if approverSuccess}<p class="employee-success" role="status">{approverSuccess}</p>{/if}
      {#if approverCandidates.length || departments.some(approverConfigured)}
        <div class="employee-table-wrap approver-table-wrap">
          <table>
            <thead>
              <tr>
                <th>部门</th>
                {#each approverLayers as item}<th>{item.label}</th>{/each}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {#each departments as department}
                <tr>
                  <td><b>{department}</b></td>
                  {#each approverLayers as item}
                    {@const summary = approverSummary(department, item.layer)}
                    <td><span class="approver-summary" class:is-default={summary === '默认'} title={approverTitle(department, item.layer)}>{summary}</span></td>
                  {/each}
                  <td>
                    <div class="employee-row-actions">
                      <button class="outline-action approver-config-action" type="button" onclick={() => openApproverEditor(department)}><Pencil size={14} />配置</button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <div class="table-panel"><div class="empty-table">暂无可选审核人，请先添加或启用员工。</div></div>
      {/if}
    </section>
  {/if}

  {#if canManageExecutionCompanies}
    <section class="employee-admin execution-company-admin">
      <div class="table-tools workbench-table-tools">
        <div class="order-table-heading"><h3>执行公司</h3><span class="filter-result">共 {executionCompanies.length} 家</span></div>
        <div class="table-actions"><button class="primary-action" type="button" disabled={companySaving} onclick={startCreateCompany}><Plus size={16} />新增执行公司</button></div>
      </div>

      {#if executionError && !creatingCompany}<p class="employee-error" role="alert">{executionError}</p>{/if}
      {#if executionSuccess}<p class="employee-success" role="status">{executionSuccess}</p>{/if}

      {#if creatingCompany}
        <form class="employee-create-form" onsubmit={(event) => { event.preventDefault(); createCompany(); }}>
          <label>执行公司名称<input aria-label="新的执行公司名称" bind:value={newCompanyName} placeholder="例如：XX 制作公司" required disabled={companySaving} /></label>
          {#if executionError}<p class="employee-error" role="alert">{executionError}</p>{/if}
          <div class="employee-row-actions">
            <button class="outline-action" type="button" disabled={companySaving} onclick={cancelCreateCompany}>取消</button>
            <button class="primary-action" type="submit" disabled={companySaving || !newCompanyName.trim()}><Plus size={16} />{companySaving ? '新增中...' : '新增执行公司'}</button>
          </div>
        </form>
      {/if}

      <div class="employee-table-wrap">
        <table>
          <thead><tr><th>执行公司名称</th><th>操作</th></tr></thead>
          <tbody>
            {#each executionCompanies as company (company.id)}
              <tr>
                <td>{#if editingCompanyId === company.id}<input aria-label="执行公司名称" bind:value={editingCompanyName} disabled={companySaving} />{:else}{company.name}{/if}</td>
                <td>
                  <div class="employee-row-actions">
                    {#if editingCompanyId === company.id}
                      <button type="button" class="icon-control" title="保存" aria-label={`保存执行公司 ${company.name}`} disabled={companySaving || !editingCompanyName.trim()} onclick={() => saveCompany(company)}><Save size={16} /></button>
                      <button type="button" class="outline-action" disabled={companySaving} onclick={cancelEditCompany}>取消</button>
                    {:else}
                      <button type="button" class="icon-control" title="编辑" aria-label={`编辑执行公司 ${company.name}`} disabled={companySaving} onclick={() => startEditCompany(company)}><Pencil size={16} /></button>
                      <button type="button" class="delete-action" title="删除" aria-label={`删除执行公司 ${company.name}`} disabled={companySaving} onclick={() => deleteCompany(company)}><Trash2 size={16} /></button>
                    {/if}
                  </div>
                </td>
              </tr>
            {:else}
              <tr><td colspan="2"><div class="empty-table">{loadingCompanies ? '加载中...' : '暂无执行公司，点击“新增执行公司”添加。'}</div></td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</section>

{#if roleGuideOpen}
  <div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeRoleGuide(); }}>
    <div class="project-modal role-guide-modal" role="dialog" aria-modal="true" aria-labelledby="role-guide-title">
      <div class="project-modal-head">
        <div>
          <p class="section-kicker">权限说明</p>
          <h2 id="role-guide-title">角色权限说明</h2>
          <span>{guideRoles.length} 类业务身份 · 当前共 {employees.length} 位员工</span>
        </div>
        <button class="icon-control" type="button" aria-label="关闭角色权限说明" onclick={closeRoleGuide}><X size={18} /></button>
      </div>
      <div class="project-modal-body role-guide-body">
        <div class="role-guide-toolbar">
          <label class="search-field"><Search size={16} /><input bind:this={roleGuideSearchInput} bind:value={roleGuideQuery} aria-label="搜索角色权限" placeholder="搜索身份或权限关键词，如“导出”" /></label>
          {#if roleGuideQuery}<button class="link-action" type="button" onclick={showAllRoles}>清空搜索</button><span class="role-guide-result" aria-live="polite">显示 {guideRoleEntries.length} / {guideRoles.length} 类身份</span>{/if}
        </div>
        <p class="role-guide-note"><ShieldCheck size={14} /><span>{roleAssignHint}</span></p>
        <div class="role-guide-grid">
          {#each guideRoleEntries as role}
            {@const info = roleInfo(role)}
            {@const count = roleCounts[role] || 0}
            <article class="role-guide-card" class:is-highlighted={roleGuideFocusRole === role}>
              <div class="role-guide-card-head">
                <h3 class="role-guide-badge" class:is-pending={role === 'pending'}>{info.label}</h3>
                <div class="role-guide-card-meta">
                  {#if role === currentRole}<span class="role-guide-current">当前身份</span>{/if}
                  <span class="role-guide-count">{count} 位员工</span>
                </div>
              </div>
              <p class="role-guide-summary">{info.summary}</p>
              <ul class="role-guide-permissions">
                {#each info.permissions as permission}
                  <li><CircleCheck size={14} /><span>{permission}</span></li>
                {:else}
                  <li><span>暂无权限说明</span></li>
                {/each}
              </ul>
              <div class="role-guide-card-footer">
                <button class="link-action role-guide-filter" type="button" onclick={() => filterByRole(role)}>筛选员工<ArrowRight size={14} /></button>
              </div>
            </article>
          {:else}
            <div class="role-guide-empty">
              <Search size={18} />
              <span>没有匹配的角色或权限，换个关键词试试。</span>
              <button class="outline-action" type="button" onclick={showAllRoles}>显示全部身份</button>
            </div>
          {/each}
        </div>
      </div>
      <div class="project-modal-footer role-guide-footer">
        <span>系统管理员账号固定；员工刷新页面后生效。</span>
        <button class="outline-action" type="button" onclick={closeRoleGuide}>关闭</button>
      </div>
    </div>
  </div>
{/if}

{#if approverEditorDepartment}
  <div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeApproverEditor(); }}>
    <div class="project-modal approver-editor-modal" role="dialog" aria-modal="true" aria-labelledby="approver-editor-title">
      <div class="project-modal-head">
        <div>
          <p class="section-kicker">审批设置</p>
          <h2 id="approver-editor-title">{approverEditorDepartment} · 三级审批</h2>
          <span>每级可多选，任一人处理即可。</span>
        </div>
        <button class="icon-control" type="button" aria-label="关闭审批设置" disabled={approverSaving === approverEditorDepartment} onclick={closeApproverEditor}><X size={18} /></button>
      </div>
      <div class="project-modal-body approver-editor-body">
        <label class="search-field"><Search size={16} /><input bind:value={approverSearch} aria-label="搜索审核人" placeholder="搜索姓名 / 用户名 / 部门" /></label>
        {#if approverError}<p class="employee-error" role="alert">{approverError}</p>{/if}
        <div class="table-panel approver-matrix">
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>员工</th>
                  {#each approverLayers as item}
                    {@const count = approverIds(approverEditorDepartment, item.layer).length}
                    <th class="approver-level-column">{item.label}<small title={defaultApproverHint(item.layer)}>{count ? `已选 ${count} 人` : '默认'}</small></th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each approverEmployeeRows(approverEditorDepartment) as employee (employee.catsco_uid)}
                  {@const assigned = approverLayers.some(({ layer }) => approverIds(approverEditorDepartment, layer).includes(employee.catsco_uid))}
                  <tr class:is-assigned={assigned}>
                    <td>
                      <b>{employee.display_name || employee.username}</b>
                      <small class="approver-employee-meta">{employee.department || '未设部门'}{#if !Boolean(employee.active) || employee.role === 'pending'} · 已停用{/if}</small>
                    </td>
                    {#each approverLayers as item}
                      <td class="approver-check-cell">
                        <label class="approver-check">
                          <input
                            type="checkbox"
                            checked={approverIds(approverEditorDepartment, item.layer).includes(employee.catsco_uid)}
                            disabled={approverSaving === approverEditorDepartment}
                            aria-label={`${employee.display_name || employee.username} · ${item.label}`}
                            onchange={(event) => toggleApprover(approverEditorDepartment, item.layer, employee.catsco_uid, event.currentTarget.checked)}
                          />
                        </label>
                      </td>
                    {/each}
                  </tr>
                {:else}
                  <tr><td colspan="4"><div class="empty-table">无匹配审核人</div></td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="project-modal-footer">
        <span aria-live="polite">{approverDirty(approverEditorDepartment) ? '有未保存的修改' : '没有修改'}</span>
        <button class="outline-action" type="button" disabled={approverSaving === approverEditorDepartment} onclick={closeApproverEditor}>取消</button>
        <button class="primary-action" type="button" disabled={approverSaving === approverEditorDepartment || !approverDirty(approverEditorDepartment)} onclick={() => saveDepartmentApprovers(approverEditorDepartment)}>{approverSaving === approverEditorDepartment ? '保存中...' : '保存'}</button>
      </div>
    </div>
  </div>
{/if}

{#if createOpen}
  <div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeCreate(); }}>
    <div class="project-modal" role="dialog" aria-modal="true" aria-labelledby="employee-create-title">
      <div class="project-modal-head"><h2 id="employee-create-title">新增员工</h2><button class="icon-control" type="button" aria-label="关闭新增员工" disabled={creatingEmployee} onclick={closeCreate}><X size={18} /></button></div>
      <form onsubmit={(event) => { event.preventDefault(); addEmployee(); }}>
        <div class="project-modal-body employee-create-body">
          <label>Catsco 用户编号 <em>*</em><input aria-label="Catsco 用户编号" type="number" min="1" step="1" bind:value={newUid} required disabled={creatingEmployee} /></label>
          <label>用户名 <em>*</em><input aria-label="用户名" bind:value={newUsername} required disabled={creatingEmployee} /></label>
          <label>员工姓名<input aria-label="员工姓名" bind:value={newName} placeholder="留空则使用用户名" disabled={creatingEmployee} /></label>
          <label>所属部门
            <select aria-label="所属部门" bind:value={newDepartment} disabled={creatingEmployee}>
              <option value="">未设置</option>
              {#each departments as department}<option value={department}>{department}</option>{/each}
            </select>
          </label>
          <label>业务身份
            <select aria-label="业务身份" bind:value={newRole} disabled={creatingEmployee}>
              {#each assignableRoles as role}<option value={role}>{role === 'pending' ? '待开通（暂不启用）' : roleLabel(role)}</option>{/each}
            </select>
            <small class="field-hint">{roleInfo(newRole).summary}；待开通身份不会启用账号。</small>
          </label>
          {#if employeeError}<p class="employee-error" role="alert">{employeeError}</p>{/if}
        </div>
        <div class="project-modal-footer">
          <button class="outline-action" type="button" disabled={creatingEmployee} onclick={closeCreate}>取消</button>
          <button type="submit" class="primary-action" disabled={creatingEmployee || !newUid || !newUsername.trim()}><Plus size={16} />{creatingEmployee ? '新增中...' : '新增员工'}</button>
        </div>
      </form>
    </div>
  </div>
{/if}
