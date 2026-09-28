<script lang="ts">
  import { ArrowLeft, Boxes, Database, PackagePlus, ReceiptText, ShieldAlert } from 'lucide-svelte';

  let { data, form }: { data: any; form: any } = $props();
  const stats = $derived(form?.stats || data.stats);
  const roleLabels: Record<string, string> = { executor: '执行', designer: '设计师', planner: '策划', manager: '管理人员', finance: '财务', owner: '老板' };
</script>

<svelte:head><title>系统管理员 · 广告订单 OA</title></svelte:head>

<main class="admin-page">
  <div class="admin-shell">
    <header class="admin-header">
      <div>
        <p class="section-kicker">员工权限</p>
        <h1>系统管理员</h1>
        <span>系统级开发管理工具，仅 Catsco 系统管理员可访问。</span>
      </div>
      <a class="outline-action" href="../orders"><ArrowLeft size={16} />返回订单</a>
    </header>

    <div class="admin-notice">
      <ShieldAlert size={19} />
      <div><b>开发管理员工具</b><span>仅 Catsco 系统管理员编号 826（账号 catsco）可访问；生成操作会向当前数据库追加模拟记录，不会覆盖已有数据。</span></div>
    </div>

    <section class="admin-action-card identity-switcher">
      <div class="admin-card-icon"><ShieldAlert size={22} /></div>
      <div class="admin-card-copy">
        <p class="section-kicker">业务身份</p>
        <h2>我的额外业务身份</h2>
        <p>设置后，离开管理页时系统管理员将仅按此业务身份查看数据并执行对应权限；管理页只能通过直接访问网址进入。当前额外身份：{data.extraIdentity ? roleLabels[data.extraIdentity.role] || data.extraIdentity.role : '未设置'}。</p>
      </div>
      <form method="POST" action="?/saveExtraIdentity">
        <label>选择额外身份
          <select name="role" aria-label="选择额外身份" required>
            {#each data.roles as role}
              <option value={role} selected={data.extraIdentity?.role === role}>{roleLabels[role] || role}</option>
            {/each}
          </select>
        </label>
        <button class="primary-action" type="submit"><ShieldAlert size={17} />保存并进入工作台</button>
      </form>
      {#if data.extraIdentity}
        <form method="POST" action="?/clearExtraIdentity"><button class="outline-action" type="submit">移除额外身份</button></form>
      {/if}
    </section>

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

    {#if data.role === 'admin'}
    <div class="admin-actions-grid">
      <section class="admin-action-card">
        <div class="admin-card-icon"><Boxes size={22} /></div>
        <div class="admin-card-copy">
          <p class="section-kicker">厂商成本库</p>
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
          <p class="section-kicker">订单与报销</p>
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
      <a href="../employees">员工与权限管理</a><a href="../catalog">查看报价成本库</a><a href="../orders">查看订单</a><a href="../reimbursements">查看报销</a>
    </footer>
    {/if}
  </div>
</main>
