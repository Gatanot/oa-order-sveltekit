<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { Plus, Save, Trash2, X } from 'lucide-svelte';
  import { api } from '$lib/api';
  import WorkbenchListFilters from '../WorkbenchListFilters.svelte';
  const desk = getContext<any>('order-desk');

  let employees = $state<any[]>([]);
  let savedEmployees = $state<any[]>([]);
  let departments = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let employeeError = $state('');
  let employeeSuccess = $state('');
  let newUid = $state('');
  let newUsername = $state('');
  let createOpen = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let filters = $state({ search: '', department: '', role: '', active: '' });
  const matchingEmployeeIds = $derived(new Set(savedEmployees.filter((employee) =>
    (!filters.search || `${employee.display_name} ${employee.username} ${employee.catsco_uid}`.toLowerCase().includes(filters.search.trim().toLowerCase())) &&
    (!filters.department || employee.department === filters.department) &&
    (!filters.role || employee.role === filters.role) &&
    (!filters.active || Boolean(employee.active) === (filters.active === 'enabled'))
  ).map((employee) => employee.catsco_uid)));
  const visibleEmployees = $derived(employees.filter((employee) => matchingEmployeeIds.has(employee.catsco_uid)));
  const roleLabels: Record<string, string> = { executor: '执行', designer: '设计师', planner: '策划', manager: '管理人员', finance: '财务', owner: '老板' };
  const filterFields = $derived([
    { key: 'search', label: '搜索', type: 'search' as const, value: filters.search, placeholder: '姓名 / 用户名 / 用户编号' },
    { key: 'department', label: '部门', value: filters.department, options: [{ value: '', label: '全部部门' }, ...departments.map((value) => ({ value, label: value }))] },
    { key: 'role', label: '身份', value: filters.role, options: [{ value: '', label: '全部身份' }, { value: 'pending', label: '待开通' }, ...roles.map((value) => ({ value, label: roleLabels[value] || value }))] },
    { key: 'active', label: '启用状态', value: filters.active, options: [{ value: '', label: '全部状态' }, { value: 'enabled', label: '已启用' }, { value: 'disabled', label: '已停用' }] },
  ]);
  function clearFilters() { filters = { search: '', department: '', role: '', active: '' }; }
  async function loadEmployees(refreshUid?: number) {
    const result = await api.get<{ data: any[]; departments: string[]; roles: string[] }>('/api/employees');
    const drafts = new Map(employees.map((employee) => [employee.catsco_uid, employee]));
    employees = result.data.map((employee) => {
      const draft = drafts.get(employee.catsco_uid);
      return refreshUid !== undefined && refreshUid !== employee.catsco_uid && draft
        ? { ...draft, canManage: employee.canManage, isSelf: employee.isSelf }
        : employee;
    });
    savedEmployees = result.data.map((employee) => ({ ...employee }));
    departments = result.departments; roles = result.roles;
  }

  async function addEmployee() {
    if (saving) return;
    saving = true;
    employeeError = '';
    employeeSuccess = '';
    try {
      await api.post('/api/employees', { uid: Number(newUid), username: newUsername });
      await loadEmployees(Number(newUid)); newUid = ''; newUsername = '';
      createOpen = false; employeeSuccess = '员工已新增';
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工创建失败'; }
    finally { saving = false; }
  }
  async function deleteEmployee(employee: any) {
    if (!await desk.requestConfirm('删除员工', `确定删除员工 ${employee.display_name}（${employee.catsco_uid}）？`)) return;
    employeeError = '';
    employeeSuccess = '';
    try {
      await api.delete('/api/employees', { uid: employee.catsco_uid });
      employees = employees.filter((item) => item.catsco_uid !== employee.catsco_uid);
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工删除失败'; }
  }
  onMount(async () => {
    try {
      await loadEmployees();
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工列表加载失败'; }
    finally { loading = false; }
  });
  async function saveEmployee(employee: any) {
    employeeError = '';
    employeeSuccess = '';
    try {
      await api.patch('/api/employees', {
        uid: Number(employee.catsco_uid),
        display_name: employee.display_name,
        department: employee.department,
        role: employee.role,
        active: Boolean(employee.active)
      });
      await loadEmployees(Number(employee.catsco_uid));
      employeeSuccess = '员工资料已保存';
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工保存失败'; }
  }
</script>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && !saving) createOpen = false; }} />

<section class="page-section workbench-list-page employee-page">
  <div class="section-heading">
    <div><p class="section-kicker">员工权限</p><h2>员工与权限管理</h2></div>
    <div class="top-actions"><button class="primary-action" type="button" onclick={() => { employeeError = ''; createOpen = true; }}><Plus size={16} />新增员工</button></div>
  </div>
  <section class="employee-admin">
    <WorkbenchListFilters fields={filterFields} onchange={(key, value) => filters[key as keyof typeof filters] = value} onclear={clearFilters} label="员工筛选" />
    <div class="workbench-statistics"><div class="workbench-statistics-head"><span>当前筛选结果 · {visibleEmployees.length} 位员工</span></div><div class="summary-row"><div><span>员工总数</span><b>{visibleEmployees.length}</b></div><div><span>已启用</span><b>{visibleEmployees.filter((employee) => employee.active).length}</b></div><div><span>待开通</span><b>{visibleEmployees.filter((employee) => employee.role === 'pending').length}</b></div><div><span>涉及部门</span><b>{new Set(visibleEmployees.map((employee) => employee.department).filter(Boolean)).size}</b></div></div></div>
    {#if employeeError && !createOpen}<p class="employee-error" role="alert">{employeeError}</p>{/if}
    {#if employeeSuccess}<p class="employee-success" role="status">{employeeSuccess}</p>{/if}
    <div class="table-tools workbench-table-tools"><div class="order-table-heading"><h3>员工明细</h3><span class="filter-result">共 {visibleEmployees.length} 位</span></div></div>
      <div class="employee-table-wrap"><table>
        <thead><tr><th>员工</th><th>用户编号</th><th>部门</th><th>身份</th><th>启用</th><th>操作</th></tr></thead>
        <tbody>{#each visibleEmployees as employee (employee.catsco_uid)}
          <tr class:employee-row-readonly={!employee.canManage && !employee.isSelf}>
            <td><input aria-label="员工姓名" bind:value={employee.display_name} disabled={!employee.canManage && !employee.isSelf} />{#if employee.isSelf}<span class="employee-self-tag">（我）</span>{/if}</td>
            <td>{employee.catsco_uid} · {employee.username}</td>
            <td><select aria-label="所属部门" bind:value={employee.department} disabled={!employee.canManage && !employee.isSelf}><option value="">未设置</option>{#each departments as department}<option value={department}>{department}</option>{/each}</select></td>
            <td><select aria-label="员工身份" bind:value={employee.role} disabled={!employee.canManage}><option value="pending">待开通</option>{#each roles as role}<option value={role}>{roleLabels[role] || role}</option>{/each}</select></td>
            <td><input type="checkbox" role="switch" aria-label={`启用员工 ${employee.display_name}`} bind:checked={employee.active} disabled={!employee.canManage} /></td>
            <td><div class="employee-row-actions">{#if employee.canManage || employee.isSelf}<button type="button" class="icon-control" title="保存" aria-label={`保存员工 ${employee.display_name}`} onclick={() => saveEmployee(employee)}><Save size={16} /></button>{/if}{#if employee.canManage}<button type="button" class="delete-action" title="删除" aria-label={`删除员工 ${employee.display_name}`} onclick={() => deleteEmployee(employee)}><Trash2 size={16} /></button>{/if}{#if !employee.canManage && !employee.isSelf}<span class="employee-locked" title="不能管理同级或更高级别的员工">无权限</span>{/if}</div></td>
          </tr>
        {:else}<tr><td colspan="6"><div class="empty-table">{loading ? '加载中...' : employees.length ? '没有符合筛选条件的员工。' : employeeError ? '员工列表加载失败。' : '暂无员工。'}{#if filterFields.some((field) => field.value)}<button class="outline-action" type="button" onclick={clearFilters}>清空筛选</button>{/if}</div></td></tr>{/each}</tbody>
      </table></div>
  </section>
</section>

{#if createOpen}
  <div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !saving) createOpen = false; }}>
    <div class="project-modal" role="dialog" aria-modal="true" aria-labelledby="employee-create-title">
      <div class="project-modal-head"><h2 id="employee-create-title">新增员工</h2><button class="icon-control" type="button" aria-label="关闭新增员工" disabled={saving} onclick={() => createOpen = false}><X size={18} /></button></div>
      <form onsubmit={(event) => { event.preventDefault(); addEmployee(); }}>
        <div class="project-modal-body employee-create-body">
          <label>Catsco 用户编号 <em>*</em><input aria-label="Catsco 用户编号" type="number" min="1" step="1" bind:value={newUid} required disabled={saving} /></label>
          <label>用户名 <em>*</em><input aria-label="用户名" bind:value={newUsername} required disabled={saving} /></label>
          {#if employeeError}<p class="employee-error" role="alert">{employeeError}</p>{/if}
        </div>
        <div class="project-modal-footer"><button class="outline-action" type="button" disabled={saving} onclick={() => createOpen = false}>取消</button><button type="submit" class="primary-action" disabled={saving}><Plus size={16} />{saving ? '新增中...' : '新增员工'}</button></div>
      </form>
    </div>
  </div>
{/if}
