<script lang="ts">
  import { ArrowLeft, Boxes, Database, PackagePlus, ReceiptText, ShieldAlert } from 'lucide-svelte';

  let { data, form }: { data: any; form: any } = $props();
  const stats = $derived(form?.stats || data.stats);
</script>

<svelte:head><title>模拟数据管理 · 广告订单 OA</title></svelte:head>

<main class="admin-page">
  <div class="admin-shell">
    <header class="admin-header">
      <div>
        <p class="section-kicker">HIDDEN ADMIN TOOL</p>
        <h1>模拟数据管理</h1>
        <span>该页面不显示在系统导航中，仅通过 <code>/admin</code> 访问。</span>
      </div>
      <a class="outline-action" href="/orders"><ArrowLeft size={16} />返回订单</a>
    </header>

    <div class="admin-notice">
      <ShieldAlert size={19} />
      <div><b>仅用于演示和测试环境</b><span>生成操作会直接向当前数据库追加记录，不会覆盖已有数据。当前项目尚未配置登录鉴权，知道地址的用户均可访问本页。</span></div>
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
      <a href="/catalog">查看报价成本库</a><a href="/orders">查看订单</a><a href="/reimbursements">查看报销</a>
    </footer>
  </div>
</main>
