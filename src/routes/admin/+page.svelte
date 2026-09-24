<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { ArrowLeft, Boxes, Database, PackagePlus, ReceiptText, ShieldAlert } from 'lucide-svelte';

  let { data, form }: { data: any; form: any } = $props();
  const stats = $derived(form?.stats || data.stats);
  let employees = $state<any[]>([]);
  let departments = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let employeeError = $state('');
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
      <div>
        <p class="section-kicker">STAFF ACCESS</p>
        <h1>员工与权限管理</h1>
        <span>管理员工状态、所属部门和业务身份。</span>
      </div>
      <a class="outline-action" href="../orders"><ArrowLeft size={16} />返回订单</a>
    </header>

    {#if data.role === 'admin'}
    <div class="admin-notice">
      <ShieldAlert size={19} />
      <div><b>开发管理员工具</b><span>仅 Catsco 管理员 UID 826（catsco）可访问；生成操作会向当前数据库追加模拟记录，不会覆盖已有数据。</span></div>
    </div>

    {#if form?.success}
      <div class="admin-result success">
        <b>模拟数据已生成</b>
        {#if form.action === 'catalogs'}
          <span>批次 {form.result.batch}：新增 {form.result.catalogs} 个厂商成本库，共 {form.result.items} 条成本项目。</span>
        {:else}
          <span>批次 {form.result.batch}：新增 {form.result.orders} 个订单和 {form.result.reimbursements} 条报销记录。</span>
        {/if}
      </div>
    {:else if form?.message}
      <div class="admin-result error"><b>生成失败</b><span>{form.message}</span></div>
    {/if}

    <section class="admin-stats" aria-label="当前数据统计">
      <div><Database size={18} /><span>全部资料库</span><b>{stats.catalogSources}</b></div>
      <div><Boxes size={18} /><span>厂商成本库</span><b>{stats.costCatalogSources}</b></div>
      <div><PackagePlus size={18} /><span>成本 / 报价项目</span><b>{stats.catalogItems}</b></div>
      <div><ReceiptText size={18} /><span>订单 / 报销</span><b>{stats.orders} / {stats.reimbursements}</b></div>
    </section>

    {/if}

    <section class="employee-admin">
      <h2>员工与权限</h2>
      <p>管理员、管理人员和老板可维护员工资料；系统管理员是固定的 Catsco UID 826（catsco），不能通过此页面授予。</p>
      {#if employeeError}<p role="alert">{employeeError}</p>{/if}
      {#if employees.length}
        <div class="employee-table-wrap"><table>
          <thead><tr><th>员工</th><th>Catsco UID</th><th>部门</th><th>身份</th><th>启用</th><th></th></tr></thead>
          <tbody>{#each employees as employee (employee.catsco_uid)}
            <tr>
              <td><input aria-label="员工姓名" bind:value={employee.display_name} /></td>
              <td>{employee.catsco_uid} · {employee.username}</td>
              <td><select aria-label="所属部门" bind:value={employee.department}><option value="">未设置</option>{#each departments as department}<option value={department}>{department}</option>{/each}</select></td>
              <td><select aria-label="员工身份" bind:value={employee.role}><option value="pending">待开通</option>{#each roles as role}<option value={role}>{({executor:'执行',designer:'设计师',planner:'策划',manager:'管理',finance:'财务',owner:'老板'} as Record<string,string>)[role] || role}</option>{/each}</select></td>
              <td><input type="checkbox" aria-label="启用员工" bind:checked={employee.active} /></td>
              <td><button type="button" class="primary-action" onclick={() => saveEmployee(employee)}>保存</button></td>
            </tr>
          {/each}</tbody>
        </table></div>
      {:else if !employeeError}<p>暂无待开通员工。员工首次通过 Catsco 访问后会出现在此处。</p>{/if}
    </section>

    {#if data.role === 'admin'}
    <div class="admin-actions-grid">
      <section class="admin-action-card">
        <div class="admin-card-icon"><Boxes size={22} /></div>
        <div class="admin-card-copy">
          <p class="section-kicker">VENDOR COST CATALOG</p>
          <h2>厂商成本库模拟数据</h2>
          <p>生成喷印制作、广告物料等成本条目。每个厂商包含 8 条成本项目，可在订单成本录入时匹配。</p>
        </div>
        <form method="POST" action="?/catalogs">
          <label>生成厂商数量
            <select name="count" aria-label="生成厂商成本库数量">
              <option value="1">1 个厂商</option>
              <option value="2" selected>2 个厂商</option>
            </select>
          </label>
          <button class="primary-action" type="submit"><PackagePlus size={17} />生成成本库</button>
        </form>
      </section>

      <section class="admin-action-card">
        <div class="admin-card-icon"><ReceiptText size={22} /></div>
        <div class="admin-card-copy">
          <p class="section-kicker">ORDERS & REIMBURSEMENTS</p>
          <h2>订单与报销模拟数据</h2>
          <p>生成多个模拟客户项目、订单产品、订单成本及报销记录，并覆盖待审核、已打回、待打款和已报销状态。</p>
        </div>
        <form method="POST" action="?/operations">
          <label>生成订单数量
            <select name="count" aria-label="生成模拟订单数量">
              <option value="24">24 个订单</option>
              <option value="36" selected>36 个订单</option>
              <option value="48">48 个订单</option>
              <option value="60">60 个订单</option>
            </select>
          </label>
          <button class="primary-action" type="submit"><ReceiptText size={17} />生成订单与报销</button>
        </form>
      </section>
    </div>

    <footer class="admin-footer">
      <a href="../catalog">查看报价成本库</a><a href="../orders">查看订单</a><a href="../reimbursements">查看报销</a>
    </footer>
    {/if}
  </div>
</main>
