<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { ChevronRight, Pencil, Plus, Save, Trash2, X } from 'lucide-svelte';
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

  function roleInfo(role: string): RoleMeta {
    return roleMeta[role] || { label: roleLabels[role] || role, summary: '自定义业务身份', permissions: [] };
  }
  function roleLabel(role: string) {
    return roleInfo(role).label;
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
  let savingEmployee = $state(false);
  let creatingEmployee = $state(false);
  let editingUid = $state<number | null>(null);
  let draft = $state<EmployeeDraft | null>(null);
  let filters = $state({ search: '', department: '', role: '', active: '' });

  let createOpen = $state(false);
  let newUid = $state('');
  let newUsername = $state('');
  let newName = $state('');
  let newDepartment = $state('');
  let newRole = $state('pending');

  const matchingEmployeeIds = $derived(new Set(savedEmployees.filter((employee) =>
    (!filters.search || `${employee.display_name} ${employee.username} ${employee.catsco_uid}`.toLowerCase().includes(filters.search.trim().toLowerCase())) &&
    (!filters.department || employee.department === filters.department) &&
    (!filters.role || employee.role === filters.role) &&
    (!filters.active || (filters.active === 'enabled'
      ? Boolean(employee.active) && employee.role !== 'pending'
      : !Boolean(employee.active) && employee.role !== 'pending'))
  ).map((employee) => employee.catsco_uid)));
  const visibleEmployees = $derived(employees.filter((employee) => matchingEmployeeIds.has(employee.catsco_uid)));
  const hasActiveFilters = $derived(filters.search !== '' || filters.department !== '' || filters.role !== '' || filters.active !== '');

  // 当前操作者可授予的身份；管理人员不能授予管理、财务或老板身份。
  const assignableRoles = $derived.by(() => {
    const available = roles.length ? roles : ['executor', 'designer', 'planner', 'manager', 'finance', 'owner'];
    if (currentRole === 'admin') return ['pending', ...available];
    if (currentRole === 'owner') return ['pending', ...available.filter((role) => role !== 'owner')];
    if (currentRole === 'manager') return ['pending', ...available.filter((role) => !['owner', 'manager', 'finance'].includes(role))];
    return ['pending'];
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

  onMount(async () => {
    if (canManageEmployees) await loadEmployees();
    if (canManageExecutionCompanies) await loadExecutionCompanies();
  });
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && createOpen && !creatingEmployee) closeCreate(); }} />

<section class="page-section workbench-list-page employee-page">
  <div class="section-heading">
    <div>
      <p class="section-kicker">{canManageEmployees ? '员工权限' : '基础资料'}</p>
      <h2>{canManageEmployees ? '员工与权限管理' : '执行公司管理'}</h2>
    </div>
    {#if canManageEmployees}
      <div class="top-actions"><button class="primary-action" type="button" onclick={startCreate}><Plus size={16} />新增员工</button></div>
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
        <div class="workbench-statistics-head"><span>当前筛选结果 · {visibleEmployees.length} 位员工</span></div>
        <div class="summary-row">
          <div><span>员工总数</span><b>{visibleEmployees.length}</b></div>
          <div><span>已启用</span><b>{visibleEmployees.filter((employee) => Boolean(employee.active) && employee.role !== 'pending').length}</b></div>
          <div><span>待开通</span><b>{visibleEmployees.filter((employee) => employee.role === 'pending').length}</b></div>
          <div><span>涉及部门</span><b>{new Set(visibleEmployees.map((employee) => employee.department).filter(Boolean)).size}</b></div>
        </div>
      </div>

      {#if employeeError && !createOpen}<p class="employee-error" role="alert">{employeeError}</p>{/if}
      {#if employeeSuccess}<p class="employee-success" role="status">{employeeSuccess}</p>{/if}

      <details class="catalog-sources-disclosure employee-role-guide">
        <summary>角色权限说明<span>{guideRoles.length} 类业务身份</span><ChevronRight size={15} /></summary>
        <div class="table-panel">
          <div class="table-scroll">
            <table>
              <thead><tr><th>身份</th><th>权限范围</th><th>可执行操作</th></tr></thead>
              <tbody>
                {#each guideRoles as role}
                  {@const info = roleInfo(role)}
                  <tr>
                    <td><b>{info.label}</b></td>
                    <td>{info.summary}</td>
                    <td>{info.permissions.join('；')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
        <p class="field-hint">系统管理员为固定账号，不在此页面授予或修改。</p>
      </details>

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
                    <small class="employee-role-summary">{roleInfo(draft.role).summary}</small>
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
                      <b>{info.label}</b>
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
