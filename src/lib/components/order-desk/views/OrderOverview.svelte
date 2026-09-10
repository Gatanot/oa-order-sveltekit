<script lang="ts">
  import { getContext } from "svelte";
  import { ListFilter, Paperclip, Search, Trash2 } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<section class="page-section">
  {#if desk.detailOrder}
    <div class="detail-card">
      <div class="section-heading"><div><p class="section-kicker">ORDER DETAIL</p><h2>{desk.detailOrder.code}</h2><span>{desk.detailOrder.customer_name} · {desk.detailOrder.project_name}</span></div><div class="top-actions"><button class="outline-action" onclick={() => desk.detailOrder = null}>返回列表</button><button class="primary-action" onclick={() => desk.editOrder(desk.detailOrder)}>编辑订单</button></div></div>
      <div class="info-grid"><div><small>联系人</small><b>{desk.detailOrder.contact || "—"}</b></div><div><small>设计 / 负责人</small><b>{desk.detailOrder.project_owner || "—"}</b></div><div><small>下单日期</small><b>{desk.detailOrder.order_date}</b></div><div><small>交货日期</small><b>{desk.detailOrder.delivery_date || "—"}</b></div><div><small>状态</small><b>{desk.detailOrder.status}</b></div><div><small>结款状态</small><b>{desk.detailOrder.payment_status || "未结款"}</b></div><div><small>销售总额</small><b>{desk.money(desk.detailOrder.quote_amount)}</b></div><div><small>制作成本</small><b>{desk.money(desk.detailOrder.cost_amount)}</b></div></div>
      <h3>产品明细</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>名称</th><th>单位</th><th>数量</th><th>单价</th><th>小计</th><th>制作要求</th></tr></thead><tbody>{#each desk.detailOrder.products as p}<tr><td>{p.name}</td><td>{p.unit}</td><td>{p.quantity}</td><td>{Number(p.unit_price || 0).toFixed(2)}</td><td>{Number(p.subtotal || Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2)}</td><td>{p.specification || "—"}</td></tr>{/each}</tbody></table></div></div>
      {#if desk.detailOrder.costs?.length}<h3>固定成本</h3><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>项目</th><th>供应商</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>{#each desk.detailOrder.costs as c}<tr><td>{c.name}</td><td>{c.vendor}</td><td>{c.quantity}</td><td>{c.unit_price}</td><td>{c.subtotal || Number(c.quantity || 0) * Number(c.unit_price || 0)}</td></tr>{/each}</tbody></table></div></div>{/if}
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
  <div class="summary-row">
    <div><span>订单数</span><b>{desk.filteredOrders.length}</b></div>
    <div><span>报价合计</span><b>{desk.money(desk.totalQuote)}</b></div>
    <div><span>成本合计</span><b>{desk.money(desk.totalCost)}</b></div>
    <div>
      <span>预计毛利</span><b class="positive"
        >{desk.money(desk.totalQuote - desk.totalCost)}</b
      >
    </div>
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
            <span>全部报价 <strong>{desk.money(project.quote)}</strong></span
            ><span
              >全部成本 <strong class="cost">{desk.money(project.cost)}</strong
              ></span
            >
          </div>
          <em>预计毛利 {desk.money(project.quote - project.cost)}</em>
        </div>{:else}<span class="muted">暂无可统计项目</span>{/each}
    </div>
  </div>
  <div class="filter-bar">
    <label class="search-field"
      ><Search size={16} /><input
        bind:value={desk.search}
        placeholder="搜索订单号、客户、项目或订单内容"
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
    ><select bind:value={desk.filterOwner}
      ><option value="">全部负责人</option>{#each desk.owners as owner}<option
          value={owner}>{owner}</option
        >{/each}</select
    ><select bind:value={desk.filterCreator}
      ><option value="">全部录入人</option
      >{#each desk.creators as creator}<option value={creator}>{creator}</option
        >{/each}</select
    ><label class="date-field"
      ><span>从</span><input type="date" bind:value={desk.filterFrom} /></label
    ><label class="date-field"
      ><span>至</span><input type="date" bind:value={desk.filterTo} /></label
    ><button
      class="filter-icon"
      title="导出当前筛选结果"
      onclick={desk.openExport}><ListFilter size={17} /></button
    >
  </div>
  <div class="table-panel">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>导出</th><th>订单信息</th><th>客户 / 项目</th><th>负责人</th
            ><th>报价</th><th>成本</th><th>录入人</th><th>日期</th><th>状态</th
            ><th>操作</th></tr
          ></thead
        ><tbody
          >{#each desk.filteredOrders as order}<tr class="order-click-row" onclick={() => desk.openDetail(order)}><td
                ><input
                  type="checkbox"
                  aria-label={`选择导出 ${order.service_name}`}
                  checked={desk.selectedOrderIds.includes(order.id)}
                  onchange={() => desk.toggleOrder(order.id)}
                /></td
              ><td
                ><b>{order.service_name}</b><small
                  >{order.code} · {order.quantity}{order.unit}</small
                ></td
              ><td
                ><b>{order.customer_name}</b><small>{order.project_name}</small
                ></td
              ><td>{order.project_owner || "未分配"}</td><td class="money"
                >{desk.money(order.quote_amount)}</td
              ><td class="money cost">{desk.money(order.cost_amount)}</td><td
                >{order.created_by}</td
              ><td>{order.order_date}</td><td
                ><span class="status-dot">{order.status}</span
                >{#if order.reimbursement_status === "待核验" || order.reimbursement_status === "待报销"}<small
                    class="status-dot">需报销</small
                  >{/if}</td
              ><td
                ><button
                  class="delete-action"
                  title="删除订单"
                  aria-label={`删除订单 ${order.service_name}`}
                  disabled={desk.busy}
                  onclick={(event) => { event.stopPropagation(); desk.deleteOrder(order); }}
                  ><Trash2 size={15} /></button
                ></td
              ></tr
            >{:else}<tr
              ><td colspan="10"
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
