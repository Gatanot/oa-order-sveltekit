<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft } from 'lucide-svelte';
  import { api } from '$lib/api';

  let { data }: { data: { role: string } } = $props();
  let employees = $state<any[]>([]);
  let departments = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let employeeError = $state('');
  let newUid = $state('');
  let newUsername = $state('');
  async function addEmployee() {
    employeeError = '';
    try {
      const result = await api.post<{ data: any }>('/api/employees', { uid: Number(newUid), username: newUsername });
      employees = [...employees, result.data]; newUid = ''; newUsername = '';
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工创建失败'; }
  }
  async function deleteEmployee(employee: any) {
    if (!confirm(`确定删除员工 ${employee.display_name}（${employee.catsco_uid}）？`)) return;
    employeeError = '';
    try {
      await api.delete('/api/employees', { uid: employee.catsco_uid });
      employees = employees.filter((item) => item.catsco_uid !== employee.catsco_uid);
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工删除失败'; }
  }
  onMount(async () => {
    try {
      const result = await api.get<{ data: any[]; departments: string[]; roles: string[] }>('/api/employees');
      employees = result.data;
      departments = result.departments;
      roles = result.roles;
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工列表加载失败'; }
  });
  async function saveEmployee(employee: any) {
    employeeError = '';
    try {
      const result = await api.patch<{ data: any }>('/api/employees', employee);
      employees = employees.map((item) => item.catsco_uid === result.data.catsco_uid ? result.data : item);
    } catch (reason) { employeeError = reason instanceof Error ? reason.message : '员工保存失败'; }
  }
</script>

<svelte:head><title>员工与权限管理 · 广告订单 OA</title></svelte:head>

<main class="admin-page">
  <div class="admin-shell">
    <header class="admin-header">
      <div><p class="section-kicker">员工权限</p><h1>员工与权限管理</h1><span>管理员工状态、所属部门和业务身份。</span></div>
      <a class="outline-action" href="./orders"><ArrowLeft size={16} />返回订单</a>
    </header>
    <section class="employee-admin">
      <h2>员工与权限</h2>
      <form class="employee-create-form" onsubmit={(event) => { event.preventDefault(); addEmployee(); }}>
        <label>Catsco 用户编号 <input type="number" min="1" bind:value={newUid} required /></label>
        <label>用户名 <input bind:value={newUsername} required /></label>
        <button type="submit" class="primary-action">新增员工</button>
      </form>
      {#if employeeError}<p class="employee-error" role="alert">{employeeError}</p>{/if}
      {#if employees.length}
        <div class="employee-table-wrap"><table>
          <thead><tr><th>员工</th><th>用户编号</th><th>部门</th><th>身份</th><th>启用</th><th></th></tr></thead>
          <tbody>{#each employees as employee (employee.catsco_uid)}
            <tr>
              <td><input aria-label="员工姓名" bind:value={employee.display_name} /></td>
              <td>{employee.catsco_uid} · {employee.username}</td>
              <td><select aria-label="所属部门" bind:value={employee.department}><option value="">未设置</option>{#each departments as department}<option value={department}>{department}</option>{/each}</select></td>
              <td><select aria-label="员工身份" bind:value={employee.role}><option value="pending">待开通</option>{#each roles as role}<option value={role}>{({executor:'执行',designer:'设计师',planner:'策划',manager:'管理人员',finance:'财务',owner:'老板'} as Record<string,string>)[role] || role}</option>{/each}</select></td>
              <td><input type="checkbox" aria-label="启用员工" bind:checked={employee.active} /></td>
              <td><div class="employee-row-actions"><button type="button" class="primary-action" onclick={() => saveEmployee(employee)}>保存</button><button type="button" class="employee-delete-action" onclick={() => deleteEmployee(employee)}>删除</button></div></td>
            </tr>
          {/each}</tbody>
        </table></div>
      {:else if !employeeError}<p class="employee-empty">暂无待开通员工。员工首次通过 Catsco 访问后会出现在此处。</p>{/if}
    </section>
  </div>
</main>
