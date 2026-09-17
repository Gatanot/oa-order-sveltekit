<script lang="ts">
  import { getContext } from "svelte";
  import { ListFilter, Paperclip, Search, Trash2 } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
  function openRow(event: KeyboardEvent, order: any) {
    if ((event.target as HTMLElement).closest("button, input, select, a")) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      desk.openDetail(order);
    }
  }
</script>

<section class="page-section">
  {#if desk.detailOrder}
    <div class="detail-card">
      <div class="section-heading"><div><p class="section-kicker">ORDER DETAIL</p><h2>{desk.detailOrder.code}</h2><span>{desk.detailOrder.customer_name} · {desk.detailOrder.project_name}</span></div><div class="top-actions"><button class="outline-action" onclick={() => desk.detailOrder = null}>返回列表</button>{#if desk.canWrite}<button class="primary-action" onclick={() => desk.editOrder(desk.detailOrder)}>编辑订单</button>{/if}</div></div>
      <div class="info-grid"><div><small>客户部门</small><b>{desk.detailOrder.customer_department || "—"}</b></div><div><small>联系人 / 下单人</small><b>{desk.detailOrder.contact || "—"}</b></div><div><small>录入人 / 开单员</small><b>{desk.detailOrder.created_by || "—"}</b></div><div><small>指定设计师</small><b>{desk.detailOrder.designer || "—"}</b></div><div><small>项目负责人</small><b>{desk.detailOrder.project_owner || "—"}</b></div><div><small>下单日期</small><b>{desk.detailOrder.order_date}</b></div><div><small>交货日期</small><b>{desk.detailOrder.delivery_date || "—"}</b></div><div><small>状态</small><b>{desk.detailOrder.status}</b></div><div><small>结款状态</small><b>{desk.detailOrder.payment_status || "未结款"}</b></div><div><small>销售总额</small><b>{desk.money(desk.detailOrder.quote_amount)}</b></div><div><small>制作成本</small><b>{desk.money(desk.detailOrder.cost_amount)}</b></div><div><small>员工垫付</small><b>{desk.money((desk.detailOrder.advances || []).reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0))}</b></div><div><small>预计毛利</small><b>{desk.money(desk.detailOrder.quote_amount - desk.detailOrder.cost_amount - (desk.detailOrder.advances || []).reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0))}</b></div></div>
      <h3>产品明细</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>名称</th><th>单位</th><th>数量</th><th>单价</th><th>小计</th><th>制作要求</th></tr></thead><tbody>{#each desk.detailOrder.products as p}<tr><td>{p.name}</td><td>{p.unit}</td><td>{p.quantity}</td><td>{Number(p.unit_price || 0).toFixed(2)}</td><td>{Number(p.subtotal || Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2)}</td><td>{p.specification || "—"}</td></tr>{/each}</tbody></table></div></div>
      {#if desk.detailOrder.costs?.length}<h3>固定成本</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>项目</th><th>供应商</th><th>单位</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>{#each desk.detailOrder.costs as c}<tr><td>{c.name}</td><td>{c.vendor}</td><td>{c.unit || "项"}</td><td>{c.quantity}</td><td>{Number(c.unit_price || 0).toFixed(2)}</td><td>{Number(c.subtotal || Number(c.quantity || 0) * Number(c.unit_price || 0)).toFixed(2)}</td></tr>{/each}</tbody></table></div></div>{/if}
      {#if desk.detailOrder.advances?.length}<h3>员工垫付</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>员工</th><th>物品</th><th>日期</th><th>金额</th><th>发票</th><th>状态</th></tr></thead><tbody>{#each desk.detailOrder.advances as advance}<tr><td>{advance.employee || desk.detailOrder.designer || "—"}</td><td>{advance.item || "—"}</td><td>{advance.date || desk.detailOrder.order_date}</td><td>{Number(advance.amount || 0).toFixed(2)}</td><td>{advance.invoice || "未上传"}</td><td><span class="status-dot">{advance.status || "待审核"}</span></td></tr>{/each}</tbody></table></div></div>{/if}
      <h3>备注附件</h3>
      {#if desk.detailAttachmentsLoading}<p class="empty-table">附件加载中...</p>
      {:else if desk.detailAttachments.length}
        <ul class="attachment-list">{#each desk.detailAttachments as file}<li>
            <a class="attachment-link" href={desk.attachmentUrl(file.id)} target="_blank" rel="noreferrer" title="在新窗口查看附件">
              <Paperclip size={14} />
              <span class="attachment-name">{file.file_name}</span>
              <small>{file.mime_type === "application/pdf" ? "PDF" : "图片"} · {desk.formatFileSize(file.file_size)}</small>
            </a>
            <span class="attachment-date">{file.created_at?.slice(0, 10)}</span>
          </li>{/each}</ul>
      {:else}<p class="empty-table">本订单暂无附件。</p>{/if}
    </div>
  {:else}
  <div class="section-heading">
    <div>
      <p class="section-kicker">OPERATIONS</p>
      <h2>全部订单</h2>
      <span>按订单日期、客户和项目负责人快速定位信息</span>
    </div>
    <div class="heading-count">
      {desk.filteredOrders.length}<small>笔订单</small>
    </div>
  </div>
  <div class="summary-row summary-row-five">
    <div><span>销售总额</span><b>{desk.money(desk.totalQuote)}</b></div>
    <div><span>制作成本</span><b>{desk.money(desk.totalCost)}</b></div>
    <div><span>员工垫付</span><b>{desk.money(desk.totalAdvance)}</b></div>
    <div><span>预计毛利</span><b class="positive">{desk.money(desk.totalQuote - desk.totalCost - desk.totalAdvance)}</b></div>
    <div><span>未结款金额</span><b>{desk.money(desk.totalUnpaid)}</b></div>
  </div>
  <div class="project-stats">
    <div class="stats-title">
      <b>项目报价 / 成本汇总</b><span
        >不受列表筛选影响，统计每个项目的全部订单</span
      >
    </div>
    <div class="stats-grid">
      {#each desk.projectStats as project}<div class="project-stat">
          <b>{project.name}</b><small
            >{project.customer_name} · {project.orderCount} 笔订单</small
          >
          <div>
            <span>全部报价 <strong>{desk.money(project.quote)}</strong></span>
            <span>全部成本 <strong class="cost">{desk.money(project.cost)}</strong></span>
            <span>员工垫付 <strong class="cost">{desk.money(project.advance)}</strong></span>
          </div>
          <em>预计毛利 {desk.money(project.quote - project.cost - project.advance)}</em>
        </div>{:else}<span class="muted">暂无可统计项目</span>{/each}
    </div>
  </div>
  <div class="filter-bar compact-filter-bar" aria-label="订单筛选">
    <span class="filter-result" aria-live="polite">已显示 {desk.filteredOrders.length} 笔</span>
    <label class="search-field"
      ><Search size={16} /><input
        bind:value={desk.search}
        placeholder="搜索订单号、客户、项目、产品、联系人或规格"
      /></label
    ><select bind:value={desk.filterCustomer}
      ><option value="">全部客户</option
      >{#each desk.customers as customer}<option value={customer.id}
          >{customer.name}</option
        >{/each}</select
    ><select bind:value={desk.filterProject}
      ><option value="">全部项目</option
      >{#each desk.projects.filter((item: any) => !desk.filterCustomer || item.customer_id === desk.filterCustomer) as project}<option
          value={project.id}>{project.name}</option
        >{/each}</select
    ><select bind:value={desk.orderSort} aria-label="订单排序"><option value="date_desc">日期：新到旧</option><option value="date_asc">日期：旧到新</option><option value="delivery_asc">交货日期：近到远</option><option value="quote_desc">报价：高到低</option><option value="quote_asc">报价：低到高</option></select
    ><button class="outline-action" type="button" onclick={() => desk.showOrderFilters = true}>更多筛选</button
    ><button class="outline-action" type="button" onclick={desk.resetOrderFilters}>重置</button
    ><details class="column-settings"><summary>显示字段</summary><div class="column-menu">{#each desk.orderColumnOptions as option}<label><input type="checkbox" checked={desk.visibleOrderColumns.includes(option[0])} onchange={() => desk.toggleOrderColumn(option[0])} />{option[1]}</label>{/each}</div></details
    ><select bind:value={desk.filterOwner} class="secondary-filter"
      ><option value="">全部负责人</option>{#each desk.owners as owner}<option value={owner}>{owner}</option>{/each}</select
    ><select bind:value={desk.filterDesigner} class="secondary-filter"
      ><option value="">全部设计师</option>{#each desk.designers as designer}<option value={designer}>{designer}</option>{/each}</select
    ><select bind:value={desk.filterPayment} class="secondary-filter"><option value="">全部结款状态</option><option>未结款</option><option>已结款</option></select
    ><select bind:value={desk.filterCreator} class="secondary-filter"
      ><option value="">全部录入人</option
      >{#each desk.creators as creator}<option value={creator}>{creator}</option
        >{/each}</select
    ><label class="date-field secondary-filter"
      ><span>从</span><input class="date-input" type="date" bind:value={desk.filterFrom} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label
    ><label class="date-field secondary-filter"
      ><span>至</span><input class="date-input" type="date" bind:value={desk.filterTo} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label
    >{#if desk.canFinance}<button
      class="filter-icon"
      title="导出当前筛选结果"
      onclick={desk.openExport}><ListFilter size={17} /></button>{/if}
  </div>
  <div class="table-panel">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>导出</th><th>订单信息</th><th>客户 / 项目</th>{#if desk.visibleOrderColumns.includes("department")}<th>客户部门</th>{/if}{#if desk.visibleOrderColumns.includes("contact")}<th>联系人</th>{/if}{#if desk.visibleOrderColumns.includes("designer")}<th>设计师</th>{/if}{#if desk.visibleOrderColumns.includes("owner")}<th>负责人</th>{/if}{#if desk.visibleOrderColumns.includes("quote")}<th>报价</th>{/if}{#if desk.visibleOrderColumns.includes("cost")}<th>成本</th>{/if}{#if desk.visibleOrderColumns.includes("creator")}<th>录入人</th>{/if}{#if desk.visibleOrderColumns.includes("date")}<th>日期</th>{/if}{#if desk.visibleOrderColumns.includes("delivery")}<th>交货日期</th>{/if}{#if desk.visibleOrderColumns.includes("payment")}<th>结款状态</th>{/if}{#if desk.visibleOrderColumns.includes("status")}<th>状态</th>{/if}<th>操作</th></tr
          ></thead
        ><tbody
          >{#each desk.filteredOrders as order}<tr class="order-click-row" tabindex="0" role="button" aria-label={`查看订单 ${order.service_name}`} onclick={() => desk.openDetail(order)} onkeydown={(event) => openRow(event, order)}><td
                ><input
                  type="checkbox"
                  aria-label={`选择导出 ${order.service_name}`}
                  checked={desk.selectedOrderIds.includes(order.id)}
                  onchange={() => desk.toggleOrder(order.id)}
                  onclick={(event) => event.stopPropagation()}
                /></td
              ><td
                ><b>{order.service_name}</b><small
                  >{order.code} · {order.quantity}{order.unit}</small
                ></td
              ><td
                ><b>{order.customer_name}</b><small>{order.project_name}</small
                ></td
              >{#if desk.visibleOrderColumns.includes("department")}<td>{order.customer_department || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("contact")}<td>{order.contact || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("designer")}<td>{order.designer || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("owner")}<td>{order.project_owner || "未分配"}</td>{/if}{#if desk.visibleOrderColumns.includes("quote")}<td class="money">{desk.money(order.quote_amount)}</td>{/if}{#if desk.visibleOrderColumns.includes("cost")}<td class="money cost">{desk.money(order.cost_amount)}</td>{/if}{#if desk.visibleOrderColumns.includes("creator")}<td>{order.created_by}</td>{/if}{#if desk.visibleOrderColumns.includes("date")}<td>{order.order_date}</td>{/if}{#if desk.visibleOrderColumns.includes("delivery")}<td>{order.delivery_date || "—"}</td>{/if}{#if desk.visibleOrderColumns.includes("payment")}<td>{order.payment_status || "未结款"}</td>{/if}{#if desk.visibleOrderColumns.includes("status")}<td
                ><span class="status-dot">{order.status}</span
                >{#if order.reimbursement_status === "待审核" || order.reimbursement_status === "待打款"}<small
                    class="status-dot">需报销</small
                  >{/if}</td>{/if}<td>{#if desk.canFinance}<button
                  class="delete-action"
                  title="删除订单"
                  aria-label={`删除订单 ${order.service_name}`}
                  disabled={desk.busy}
                  onclick={(event) => { event.stopPropagation(); desk.deleteOrder(order); }}
                  ><Trash2 size={15} /></button>{:else}<span class="muted">—</span>{/if}</td></tr
            >{:else}<tr
              ><td colspan="15"
                ><div class="empty-table">
                  没有匹配的订单，先录入一笔订单吧。
                </div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
  {/if}
</section>
