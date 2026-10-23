<script lang="ts">
  import { getContext } from "svelte";
  import { Banknote, Check, ChevronLeft, ChevronRight, Download, Info, ListChecks, Paperclip, Plus, RefreshCw, Trash2, X } from "lucide-svelte";
  import OrderRowActions from '../OrderRowActions.svelte';
  import OrderListFilters from '../OrderListFilters.svelte';
  import ReimbursementStatus from '../ReimbursementStatus.svelte';
  const desk = getContext<any>("order-desk");
  let columnSettingsEl = $state<HTMLDetailsElement | null>(null);
  let refreshing = $state(false);
  let statisticsExpanded = $state(false);
  async function refreshOrders() {
    refreshing = true;
    try { await desk.refresh(); }
    catch (reason) { desk.notify(reason instanceof Error ? reason.message : '刷新失败', true); }
    finally { refreshing = false; }
  }
  function closeColumnSettingsOnOutsideClick(event: MouseEvent) {
    if (!columnSettingsEl?.open) return;
    if (columnSettingsEl.contains(event.target as Node)) return;
    columnSettingsEl.open = false;
  }
  const designAttachments = $derived((desk.detailAttachments as any[]).filter((file: any) => file.attachment_kind === "design"));
  const noteAttachments = $derived((desk.detailAttachments as any[]).filter((file: any) => file.attachment_kind !== "design"));
  const allPageSelected = $derived(desk.pagedOrders.length > 0 && desk.pagedOrders.every((order: any) => desk.bulkOrderIds.includes(order.id)));
  const somePageSelected = $derived(desk.pagedOrders.some((order: any) => desk.bulkOrderIds.includes(order.id)));
  const hasExtraColumns = $derived(desk.visibleOrderColumns.some((key: string) => ['department', 'contact', 'designer', 'creator', 'delivery'].includes(key)));
  const hasFilters = $derived([desk.search, desk.filterCustomer, desk.filterProject, desk.filterPayment, desk.filterFrom, desk.filterTo, desk.filterDesigner, desk.filterPlanner, desk.filterOwner, desk.filterCreator].some(Boolean));
  function activateRow(order: any) {
    if (desk.bulkMode) desk.toggleBulkOrder(order.id);
    else desk.openDetail(order);
  }
  function openRow(event: KeyboardEvent, order: any) {
    if ((event.target as HTMLElement).closest("button, input, select, a")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateRow(order);
    }
  }
</script>

<svelte:window onclick={closeColumnSettingsOnOutsideClick} />

<section class="page-section order-overview">
  {#if desk.detailOrder}
    <div class="detail-card">
      <div class="section-heading"><div><p class="section-kicker">订单详情</p><h2>{desk.detailOrder.code}</h2><span>{desk.detailOrder.customer_name} · {desk.detailOrder.project_name}</span></div><div class="top-actions"><button class="outline-action" onclick={() => desk.navigate('/orders')}>返回列表</button>{#if desk.canCompleteOrder(desk.detailOrder)}<button class="primary-action" onclick={() => desk.openCompleteOrder(desk.detailOrder)}>标记完成</button>{/if}{#if desk.canWrite}<button class="outline-action" onclick={() => desk.editOrder(desk.detailOrder)}>编辑订单</button>{/if}</div></div>
      <div class="info-grid"><div><small>客户部门</small><b>{desk.detailOrder.customer_department || "—"}</b></div><div><small>联系人 / 下单人</small><b>{desk.detailOrder.contact || "—"}</b></div><div><small>录入人 / 开单员</small><b>{desk.detailOrder.created_by || "—"}</b></div><div><small>指定设计师</small><b>{desk.detailOrder.designer || "—"}</b></div><div><small>指定策划人</small><b>{desk.detailOrder.planner || "—"}</b></div><div><small>项目负责人</small><b>{desk.detailOrder.project_owner || "—"}</b></div><div><small>执行公司</small><b>{desk.detailOrder.execution_company || "—"}</b></div><div><small>下单日期</small><b>{desk.detailOrder.order_date}</b></div><div><small>交货日期</small><b>{desk.detailOrder.delivery_date || "—"}</b></div><div><small>状态</small><b>{desk.detailOrder.status}</b></div><div><small>结款状态</small><b>{desk.detailOrder.payment_status || "未结款"}</b></div><div><small>销售总额</small><b>{desk.money(desk.detailOrder.quote_amount)}</b></div><div><small>制作成本</small><b>{desk.money(desk.detailOrder.cost_amount)}</b></div><div><small>关联报销</small><b>{desk.money((desk.detailOrder.advances || []).reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0))}</b></div><div><small>预计毛利</small><b>{desk.money(desk.detailOrder.quote_amount - desk.detailOrder.cost_amount - (desk.detailOrder.advances || []).reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0))}</b></div></div>
      <h3>产品明细</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>序号</th><th>名称</th><th>单位</th><th>数量</th><th>单价</th><th>小计</th><th>制作要求</th><th>行备注</th></tr></thead><tbody>{#each desk.detailOrder.products as p, i}<tr><td>{i + 1}</td><td>{p.name}</td><td>{p.unit}</td><td>{p.quantity}</td><td>{Number(p.unit_price || 0).toFixed(2)}</td><td>{Number(p.subtotal || Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2)}</td><td>{p.specification || "—"}</td><td>{p.remark || "—"}</td></tr>{/each}</tbody></table></div></div>
      {#if desk.detailOrder.costs?.length}<h3>固定成本</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>项目</th><th>供应商</th><th>单位</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>{#each desk.detailOrder.costs as c}<tr><td>{c.name}</td><td>{c.vendor}</td><td>{c.unit || "项"}</td><td>{c.quantity}</td><td>{Number(c.unit_price || 0).toFixed(2)}</td><td>{Number(c.subtotal || Number(c.quantity || 0) * Number(c.unit_price || 0)).toFixed(2)}</td></tr>{/each}</tbody></table></div></div>{/if}
      <h3>关联报销</h3>{#if desk.detailOrder.advances?.length}<div class="table-panel"><div class="table-scroll"><table><thead><tr><th>报销人</th><th>报销物品</th><th>垫付日期</th><th>金额</th><th>发票</th><th>状态</th></tr></thead><tbody>{#each desk.detailOrder.advances as advance}<tr><td>{advance.employee || desk.detailOrder.designer || "—"}</td><td>{advance.item || "—"}</td><td>{advance.date || desk.detailOrder.order_date}</td><td>{Number(advance.amount || 0).toFixed(2)}</td><td>{#if advance.attachment_id}<button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(advance.attachment_id), advance.invoice || '发票附件')}>{advance.invoice || "查看发票"}</button>{:else}{advance.invoice || "未上传"}{/if}</td><td><ReimbursementStatus status={advance.status || "待审核"} /></td></tr>{/each}</tbody></table></div></div>{:else}<p class="empty-table">本订单暂无关联报销，可在“我的报销”中发起报销并关联此订单。</p>{/if}
      <h3>备注 / 制作说明</h3><div class="order-note">{desk.detailOrder.note || "暂无备注。"}</div>
      <h3>设计图</h3>
      {#if desk.detailAttachmentsLoading}<p class="empty-table">设计图加载中...</p>
      {:else if designAttachments.length}
        <ul class="attachment-list">{#each designAttachments as file}<li>
            <button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.attachmentUrl(file.id), file.file_name, file.mime_type)} title="在当前页面预览设计图">
              <Paperclip size={14} />
              <span class="attachment-name">{file.file_name}</span>
              <small>{file.mime_type === "application/pdf" ? "PDF" : "图片"} · {desk.formatFileSize(file.file_size)}</small>
            </button>
            <span class="attachment-date">{file.created_at?.slice(0, 10)}</span>
          </li>{/each}</ul>
      {:else}<p class="empty-table">暂无设计图。设计师完成订单时需上传设计图。</p>{/if}
      <h3>备注附件</h3>
      {#if desk.detailAttachmentsLoading}<p class="empty-table">附件加载中...</p>
      {:else if noteAttachments.length}
        <ul class="attachment-list">{#each noteAttachments as file}<li>
            <button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.attachmentUrl(file.id), file.file_name, file.mime_type)} title="在当前页面预览附件">
              <Paperclip size={14} />
              <span class="attachment-name">{file.file_name}</span>
              <small>{file.mime_type === "application/pdf" ? "PDF" : "图片"} · {desk.formatFileSize(file.file_size)}</small>
            </button>
            <span class="attachment-date">{file.created_at?.slice(0, 10)}</span>
          </li>{/each}</ul>
      {:else}<p class="empty-table">本订单暂无附件。</p>{/if}
    </div>
  {:else}
  <div class="section-heading">
    <div>
      <p class="section-kicker">订单管理</p>
      <h2>订单列表</h2>
    </div>
    <div class="heading-actions">
      <button class="icon-control" class:refreshing title="刷新数据" aria-label="刷新数据" aria-busy={refreshing} disabled={desk.busy || refreshing} onclick={refreshOrders}><RefreshCw size={17} /></button>
      {#if desk.canWrite}<button class="primary-action" onclick={() => desk.navigate("/orders/new")}><Plus size={16} />新增订单</button>{/if}
    </div>
  </div>
  <OrderListFilters />
  {#if desk.showOrderStatistics}
  <section class="order-statistics" aria-label="筛选订单统计">
    <div class="order-statistics-head"><span aria-live="polite">当前筛选结果 · {desk.filteredOrders.length} 笔订单</span><button class="statistics-help" type="button" aria-label="统计说明" aria-expanded={statisticsExpanded} aria-controls="order-statistics-description" onclick={() => statisticsExpanded = !statisticsExpanded} title="统计覆盖当前筛选的全部订单，包含其他分页。预计毛利 = 销售总额 - 制作成本 - 关联报销金额；毛利率按销售总额计算。未结款金额为标记未结款的订单销售总额。">统计说明<Info size={14} /></button></div>
    {#if statisticsExpanded}<p id="order-statistics-description" class="order-statistics-description">统计覆盖当前筛选的全部订单，包含其他分页。预计毛利 = 销售总额 − 制作成本 − 关联报销金额；毛利率按销售总额计算。未结款金额为标记未结款的订单销售总额。</p>{/if}
    <div class="summary-row summary-row-five">
    <div><span>销售总额</span><b>{desk.money(desk.totalQuote)}</b></div>
    <div><span>制作成本</span><b>{desk.money(desk.totalCost)}</b></div>
    <div><span>报销金额</span><b>{desk.money(desk.totalAdvance)}</b></div>
    <div><span>预计毛利</span><b class="positive">{desk.money(desk.totalQuote - desk.totalCost - desk.totalAdvance)}</b><small>毛利率 {desk.totalQuote ? ((desk.totalQuote - desk.totalCost - desk.totalAdvance) / desk.totalQuote * 100).toFixed(1) : "0.0"}%</small></div>
    <div><span>未结款金额</span><b>{desk.money(desk.totalUnpaid)}</b></div>
    </div>
  </section>
  {/if}
  <div class="table-tools">
    <div class="order-table-heading"><h3>订单明细</h3><span class="filter-result" aria-live="polite">共 {desk.filteredOrders.length} 笔，第 {desk.orderPage} / {desk.orderPageCount} 页</span></div>
    <div class="table-actions">
      <select class="order-sort-select" aria-label="订单排序" bind:value={desk.orderSort} disabled={desk.bulkRunning}><option value="date_desc">日期：新到旧</option><option value="date_asc">日期：旧到新</option><option value="delivery_asc">交货日期：近到远</option><option value="quote_desc">报价：高到低</option><option value="quote_asc">报价：低到高</option></select>
      {#if !desk.bulkMode && (desk.canExportOrders || desk.canManageOrders)}<button class="outline-action" type="button" disabled={desk.busy} onclick={() => desk.setBulkMode(true)}><ListChecks size={16} />批量处理</button>{/if}
      <details class="column-settings" bind:this={columnSettingsEl}><summary>显示字段</summary><div class="column-menu">{#each desk.orderColumnOptions as option}<label><input type="checkbox" checked={desk.visibleOrderColumns.includes(option[0])} onchange={() => desk.toggleOrderColumn(option[0])} />{option[1]}</label>{/each}</div></details>
    </div>
  </div>
  {#if desk.bulkMode}
    <div class="order-bulk-toolbar" aria-label="批量订单操作" aria-busy={desk.bulkRunning}>
      <label class="bulk-page-select"><input type="checkbox" aria-label="全选当前页" checked={allPageSelected} indeterminate={somePageSelected && !allPageSelected} disabled={desk.bulkRunning} onchange={() => desk.toggleBulkPage()} /><span>全选当前页</span></label>
      <span class="bulk-count" aria-live="polite">已选 {desk.bulkOrderIds.length} 项</span>
      <div class="bulk-actions">
        {#if desk.canExportOrders}<button class="outline-action" disabled={!desk.bulkOrderIds.length || desk.busy} onclick={() => desk.openExport(desk.bulkOrderIds)}><Download size={16} />导出</button>{/if}
        {#if desk.canManageOrders}<button class="outline-action" disabled={!desk.bulkOrderIds.length || desk.busy} onclick={() => desk.runBulkOrders('已结款')}><Banknote size={16} />标记已结款</button><button class="outline-action" disabled={!desk.bulkOrderIds.length || desk.busy} onclick={() => desk.runBulkOrders('未结款')}><Banknote size={16} />标记未结款</button>{/if}
        {#if desk.canDeleteOrders}<button class="delete-action" disabled={!desk.bulkOrderIds.length || desk.busy} onclick={() => desk.runBulkOrders('delete')}><Trash2 size={16} />删除</button>{/if}
        <button class="outline-action" disabled={desk.bulkRunning} onclick={() => desk.setBulkMode(false)}><X size={16} />退出批量</button>
      </div>
      {#if desk.bulkRunning}<span class="bulk-progress" role="status">已处理 {desk.bulkProgress} 笔</span>{/if}
    </div>
    {#if desk.bulkResult}
      <div class="bulk-result" role="status">
        <span>成功 {desk.bulkResult.success} 笔，失败 {desk.bulkResult.failed.length} 笔</span>
        {#if desk.bulkResult.refreshError}<span class="bulk-error">数据刷新失败：{desk.bulkResult.refreshError}</span>{/if}
        {#if desk.bulkResult.failed.length}<details><summary>失败详情</summary><ul>{#each desk.bulkResult.failed as item}<li>{item.code}：{item.message}</li>{/each}</ul></details>{/if}
      </div>
    {/if}
  {/if}
  <div class="table-panel desktop-order-table" class:extra-columns={hasExtraColumns}>
    <div class="table-scroll">
      <table class="order-list-table">
        <thead
          ><tr
            ><th class="order-index-column">{#if desk.bulkMode}<input type="checkbox" aria-label="全选当前页订单" checked={allPageSelected} indeterminate={somePageSelected && !allPageSelected} disabled={desk.bulkRunning} onchange={() => desk.toggleBulkPage()} />{:else}序号{/if}</th><th class="order-info-column">订单信息</th><th class="order-project-column">客户 / 项目</th>{#if desk.visibleOrderColumns.includes("department")}<th>客户部门</th>{/if}{#if desk.visibleOrderColumns.includes("contact")}<th>联系人</th>{/if}{#if desk.visibleOrderColumns.includes("designer")}<th>设计师</th>{/if}{#if desk.visibleOrderColumns.includes("owner")}<th class="order-person-column">负责人</th>{/if}{#if desk.visibleOrderColumns.includes("quote")}<th class="order-money-column">报价</th>{/if}{#if desk.visibleOrderColumns.includes("cost")}<th class="order-money-column">成本</th>{/if}{#if desk.visibleOrderColumns.includes("creator")}<th>录入人</th>{/if}{#if desk.visibleOrderColumns.includes("date")}<th class="order-date-column">日期</th>{/if}{#if desk.visibleOrderColumns.includes("delivery")}<th>交货日期</th>{/if}{#if desk.visibleOrderColumns.includes("payment")}<th class="order-payment-column">结款状态</th>{/if}{#if desk.visibleOrderColumns.includes("status")}<th class="order-status-column">状态</th>{/if}<th class="order-action-column">操作</th></tr
          ></thead
        ><tbody
          >{#each desk.pagedOrders as order, i}<tr class="order-click-row" class:bulk-selected={desk.bulkMode && desk.bulkOrderIds.includes(order.id)} aria-pressed={desk.bulkMode ? desk.bulkOrderIds.includes(order.id) : undefined} tabindex="0" role="button" aria-label={`查看订单 ${order.service_name}`} onclick={() => activateRow(order)} onkeydown={(event) => openRow(event, order)}><td class="order-index-column">{#if desk.bulkMode}<input type="checkbox" aria-label={`选择订单 ${order.code}`} checked={desk.bulkOrderIds.includes(order.id)} disabled={desk.bulkRunning} onchange={() => desk.toggleBulkOrder(order.id)} onclick={(event) => event.stopPropagation()} />{:else}{(desk.orderPage - 1) * desk.orderPageSize + i + 1}{/if}</td><td class="order-info-column"
                title={`${order.service_name} · ${order.code}`}><b>{order.service_name}</b><small
                  >{order.code} · {order.quantity}{order.unit}</small
                ></td
              ><td class="order-project-column" title={`${order.customer_name} · ${order.project_name}`}
                ><b>{order.customer_name}</b><small>{order.project_name}</small
                ></td
              >{#if desk.visibleOrderColumns.includes("department")}<td title={order.customer_department || "—"}>{order.customer_department || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("contact")}<td title={order.contact || "—"}>{order.contact || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("designer")}<td title={order.designer || "—"}>{order.designer || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("owner")}<td class="order-person-column" title={order.project_owner || "未分配"}>{order.project_owner || "未分配"}</td>{/if}{#if desk.visibleOrderColumns.includes("quote")}<td class="money order-money-column">{desk.money(order.quote_amount)}</td>{/if}{#if desk.visibleOrderColumns.includes("cost")}<td class="money cost order-money-column">{desk.money(order.cost_amount)}</td>{/if}{#if desk.visibleOrderColumns.includes("creator")}<td>{order.created_by}</td>{/if}{#if desk.visibleOrderColumns.includes("date")}<td class="order-date-column">{order.order_date}</td>{/if}{#if desk.visibleOrderColumns.includes("delivery")}<td>{order.delivery_date || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("payment")}<td class="order-payment-column">{order.payment_status || "未结款"}</td>{/if}{#if desk.visibleOrderColumns.includes("status")}<td class="order-status-column"
                ><span class="status-dot">{order.status}</span
                >{#if order.reimbursement_status === "待审核" || order.reimbursement_status === "待打款"}<small
                    class="status-dot">需报销</small
                  >{/if}</td>{/if}<td class="order-action-column"><OrderRowActions {order} /></td></tr
            >{:else}<tr
              ><td colspan={4 + desk.visibleOrderColumns.length}
                ><div class="empty-table">
                  {hasFilters ? '没有匹配的订单' : '暂无订单'}
                  {#if hasFilters}<button class="outline-action" disabled={desk.bulkRunning} onclick={desk.resetOrderFilters}>清空筛选</button>{:else if desk.canWrite}<button class="primary-action" onclick={() => desk.navigate('/orders/new')}><Plus size={16} />新增订单</button>{/if}
                </div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
  <div class="mobile-order-list" aria-label="订单列表">
    {#each desk.pagedOrders as order}
      <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
      <article class="mobile-order-card" class:bulk-selected={desk.bulkMode && desk.bulkOrderIds.includes(order.id)} aria-pressed={desk.bulkMode ? desk.bulkOrderIds.includes(order.id) : undefined} tabindex="0" role="button" aria-label={`查看订单 ${order.service_name}`} onclick={() => activateRow(order)} onkeydown={(event) => openRow(event, order)}>
        <div class="mobile-order-card-head">
          <div class="mobile-order-card-title"><b>{order.service_name}</b><small>{order.code} · {order.quantity}{order.unit}</small></div>
          {#if desk.bulkMode}<input type="checkbox" aria-label={`选择订单 ${order.code}`} checked={desk.bulkOrderIds.includes(order.id)} disabled={desk.bulkRunning} onchange={() => desk.toggleBulkOrder(order.id)} onclick={(event) => event.stopPropagation()} />{/if}
        </div>
        <div class="mobile-order-card-project"><b>{order.customer_name}</b><span>{order.project_name}</span></div>
        <div class="mobile-order-card-meta">
          <span><small>报价</small><b class="money">{desk.money(order.quote_amount)}</b></span>
          <span><small>成本</small><b class="money cost">{desk.money(order.cost_amount)}</b></span>
          <span><small>日期</small><b>{order.order_date}</b></span>
          <span><small>状态</small><b><span class="status-dot">{order.status}</span></b></span>
        </div>
        <div class="mobile-order-card-foot"><span>{order.payment_status || "未结款"}{order.reimbursement_status === "待审核" || order.reimbursement_status === "待打款" ? " · 需报销" : ""}</span><OrderRowActions {order} /></div>
      </article>
    {:else}
      <div class="empty-table">{hasFilters ? '没有匹配的订单' : '暂无订单'}{#if hasFilters}<button class="outline-action" disabled={desk.bulkRunning} onclick={desk.resetOrderFilters}>清空筛选</button>{:else if desk.canWrite}<button class="primary-action" onclick={() => desk.navigate('/orders/new')}><Plus size={16} />新增订单</button>{/if}</div>
    {/each}
  </div>
  {#if desk.orderPageCount > 1}
    <nav class="order-pagination" aria-label="订单分页">
      <button class="icon-control" title="上一页" aria-label="上一页" disabled={desk.orderPage === 1} onclick={() => desk.setOrderPage(desk.orderPage - 1)}><ChevronLeft size={17} /></button>
      <div class="order-page-numbers">
        {#each Array(desk.orderPageCount) as _, i}
          {@const page = i + 1}
          {#if page === 1 || page === desk.orderPageCount || Math.abs(page - desk.orderPage) <= 1}
            <button class:active={page === desk.orderPage} class="order-page-number" aria-label={`第 ${page} 页`} aria-current={page === desk.orderPage ? "page" : undefined} onclick={() => desk.setOrderPage(page)}>{page}</button>
          {:else if page === 2 || page === desk.orderPageCount - 1}
            <span class="order-page-ellipsis">…</span>
          {/if}
        {/each}
      </div>
      <button class="icon-control" title="下一页" aria-label="下一页" disabled={desk.orderPage === desk.orderPageCount} onclick={() => desk.setOrderPage(desk.orderPage + 1)}><ChevronRight size={17} /></button>
    </nav>
  {/if}
  {/if}
</section>
