<script lang="ts">
  import { getContext } from "svelte";
  import { Paperclip } from "lucide-svelte";
  const desk = getContext<any>("order-desk");

  let attachmentsByOrder = $state<Record<string, Array<any>>>({});
  let detailItem = $state<any>(null);
  async function showAttachments(item: any) {
    const orderId = item.id;
    if (attachmentsByOrder[orderId]) {
      const next = { ...attachmentsByOrder };
      delete next[orderId];
      attachmentsByOrder = next;
      return;
    }
    try {
      const files = item.id.startsWith("standalone:")
        ? (await fetch(`/api/reimbursements/${item.id.replace("standalone:", "")}/attachments`).then((response) => response.json())).data
        : await desk.fetchAdvanceAttachments(item.order_id, item.advance_id);
      attachmentsByOrder = { ...attachmentsByOrder, [orderId]: files };
    } catch {
      attachmentsByOrder = { ...attachmentsByOrder, [orderId]: [] };
    }
  }
</script>

<section class="page-section">
  <div class="section-heading">
    <div>
      <p class="section-kicker">FINANCE REVIEW</p>
      <h2>员工垫付 / 报销核验</h2>
      <span
        >未选择报价成本库的订单默认进入这里，按项目、垫付人员和垫付日期核验。</span
      >
    </div>
    <div class="top-actions"><button class="primary-action" type="button" onclick={desk.openStandaloneReimbursement}><Paperclip size={15} />新建报销</button></div>
  </div>
  <div class="summary-row reimbursement-summary">
    <div><span>待核验</span><b>{desk.reimbursementStats.pendingReview}<small> 条</small></b></div>
    <div><span>待报销</span><b>{desk.reimbursementStats.pendingPay}<small> 条</small></b></div>
    <div><span>报销总额</span><b>{desk.money(desk.reimbursementStats.amount)}</b></div>
  </div>
  <div class="filter-bar">
    <select bind:value={desk.reimbursementProject}
      ><option value="">全部项目</option>{#each desk.projects as project}<option
          value={project.id}>{project.name}</option
        >{/each}</select
    ><select bind:value={desk.reimbursementPerson}
      ><option value="">全部人员</option>{#each desk.reimbursementPeople as person}<option
          value={person}>{person}</option
        >{/each}</select
    ><select bind:value={desk.reimbursementStatus}
      ><option value="">全部状态</option><option value="待核验">待核验</option
      ><option value="待报销">待报销</option><option value="已报销"
        >已报销</option
      ></select
    ><label class="date-field"
      ><span>从</span><input
        class="date-input"
        type="date"
        bind:value={desk.reimbursementFrom}
        onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()}
      /></label
    ><label class="date-field"
      ><span>至</span><input
        class="date-input"
        type="date"
        bind:value={desk.reimbursementTo}
        onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()}
      /></label
    >
  </div>
  <div class="reimbursement-actions"><button class="outline-action" type="button" onclick={desk.exportReimbursements}>导出明细</button><button class="outline-action" type="button" disabled={!desk.selectedReimbursementIds.length || desk.busy} onclick={desk.batchMarkReimbursed}>标记已报销（{desk.selectedReimbursementIds.length}）</button></div>
  <div class="table-panel">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>选择</th><th>来源订单</th><th>项目 / 垫付员工</th><th>垫付日期</th><th>垫付物品</th><th
              >金额</th
            ><th>备注附件</th><th>报销状态</th><th>操作</th></tr
          ></thead
        ><tbody
          >{#each desk.reimbursements.filter((item: any) => (!desk.reimbursementProject || item.project_id === desk.reimbursementProject) && (!desk.reimbursementPerson || item.employee === desk.reimbursementPerson) && (!desk.reimbursementStatus || item.reimbursement_status === desk.reimbursementStatus) && (!desk.reimbursementFrom || item.advance_date >= desk.reimbursementFrom) && (!desk.reimbursementTo || item.advance_date <= desk.reimbursementTo)) as item}<tr
              ><td><input type="checkbox" aria-label={`选择报销 ${item.advance_item || item.item}`} checked={desk.selectedReimbursementIds.includes(item.id)} onchange={() => desk.toggleReimbursement(item.id)} /></td><td>{#if item.order_id}<button class="link-action" type="button" onclick={() => desk.openDetail(desk.orders.find((order: any) => order.id === item.order_id))}><b>{item.code}</b></button>{:else}<b class="muted">内务报销</b>{/if}</td><td
                ><b>{item.project_name}</b><small>{item.employee}</small></td
              ><td>{item.advance_date}</td><td>{item.advance_item || "—"}</td><td
                class="money">{desk.money(item.advance_amount)}</td
              ><td
                >{#if item.attachment_count}<button
                    class="attachment-toggle"
                    title="展开附件列表"
                    onclick={() => showAttachments(item)}
                    ><Paperclip size={14} />{item.attachment_count} 个</button
                  >{:else}<span class="muted attachment-none"><Paperclip size={14} /> 未上传</span
                  >{/if}</td
              ><td
                ><span class="status-dot">{item.reimbursement_status}</span></td
              ><td
                ><button class="link-action" type="button" onclick={() => detailItem = item}>查看单据</button><br />{#if item.reimbursement_status === "待核验"}<button
                    class="primary-action"
                    onclick={() => desk.markReimbursement(item, "待报销")}
                    >确认待报销</button
                  >{:else if item.reimbursement_status === "待报销"}<button
                    class="primary-action"
                    onclick={() => desk.markReimbursement(item, "已报销")}
                    >标记已报销</button
                  >{:else}<span class="muted">已完成</span>{/if}</td
              ></tr
            >{#if attachmentsByOrder[item.id]?.length}<tr class="attachment-row"
                ><td colspan="9"
                  ><ul class="attachment-list">{#each attachmentsByOrder[item.id] as file}<li>
                        <a
                          class="attachment-link"
                          href={item.id.startsWith("standalone:") ? desk.reimbursementAttachmentUrl(file.id) : desk.attachmentUrl(file.id)}
                          target="_blank"
                          rel="noreferrer"
                          title="在新窗口查看附件"
                          ><Paperclip size={13} />
                          <span class="attachment-name">{file.file_name}</span>
                          <small>{file.mime_type === "application/pdf" ? "PDF" : "图片"} · {desk.formatFileSize(file.file_size)}</small>
                        </a>
                      </li>{/each}</ul></td
                ></tr
              >{/if}{:else}<tr
              ><td colspan="9"
                ><div class="empty-table">暂无需要报销核验的订单。</div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
  {#if detailItem}
    <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailItem = null; }}>
      <div class="export-drawer reimbursement-detail" role="dialog" aria-modal="true" aria-labelledby="reimbursement-detail-title">
        <div class="drawer-head"><div><p class="section-kicker">REIMBURSEMENT VOUCHER</p><h2 id="reimbursement-detail-title">报销单据</h2><span>{detailItem.source_type || "订单报销"} · {detailItem.reimbursement_status}</span></div><button class="icon-control" aria-label="关闭报销单据" onclick={() => detailItem = null}>×</button></div>
        <div class="drawer-body"><div class="voucher-grid"><div><small>报销人</small><b>{detailItem.employee}</b></div><div><small>报销物品</small><b>{detailItem.advance_item || detailItem.item}</b></div><div><small>报销金额</small><b>{desk.money(detailItem.advance_amount)}</b></div><div><small>垫付日期</small><b>{detailItem.advance_date}</b></div><div><small>关联订单</small><b>{detailItem.code || "内务报销"}</b></div><div><small>客户 / 项目</small><b>{detailItem.customer_name ? `${detailItem.customer_name} · ` : ""}{detailItem.project_name || "内务报销"}</b></div><div class="voucher-full"><small>发票附件</small><b>{detailItem.invoice || "未上传"}</b></div><div class="voucher-full"><small>备注</small><b>{detailItem.note || "—"}</b></div></div></div>
        <div class="drawer-footer"><button class="outline-action" type="button" onclick={() => detailItem = null}>关闭</button></div>
      </div>
    </div>
  {/if}
</section>
