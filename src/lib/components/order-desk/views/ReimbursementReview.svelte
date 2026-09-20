<script lang="ts">
  import { getContext } from "svelte";
  import { Check, Circle, CircleDot, Paperclip, X } from "lucide-svelte";
  const desk = getContext<any>("order-desk");

  let attachmentsByOrder = $state<Record<string, Array<any>>>({});
  let detailItem = $state<any>(null);
  async function showAttachments(item: any) {
    const reimbursementId = item.id;
    if (attachmentsByOrder[reimbursementId]) {
      const next = { ...attachmentsByOrder };
      delete next[reimbursementId];
      attachmentsByOrder = next;
      return;
    }
    try {
      const response = await fetch(`/api/reimbursements/${encodeURIComponent(reimbursementId)}/attachments`);
      if (!response.ok) throw new Error("附件加载失败");
      const files = (await response.json()).data;
      attachmentsByOrder = { ...attachmentsByOrder, [reimbursementId]: files };
    } catch {
      attachmentsByOrder = { ...attachmentsByOrder, [reimbursementId]: [] };
    }
  }
</script>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') detailItem = null; }} />

<section class="page-section">
  <div class="section-heading">
    <div>
      <p class="section-kicker">{desk.reimbursementRole === "finance" ? "FINANCE REVIEW" : "MY EXPENSES"}</p>
      <h2>{desk.reimbursementRole === "finance" ? "报销审核与付款" : "我的报销"}</h2>
      <span>{desk.reimbursementRole === "finance" ? "审核员工提交的报销，并集中处理待付款记录。" : "查看本人提交的报销记录和当前处理进度。"}</span>
    </div>
    {#if desk.canWrite || desk.canFinance}<div class="top-actions"><button class="primary-action" type="button" onclick={desk.openStandaloneReimbursement}><Paperclip size={15} />{desk.canFinance ? "代员工录入" : "新建报销"}</button></div>{/if}
  </div>
  <div class="summary-row reimbursement-summary">
    {#if desk.reimbursementRole === "finance"}
      <div><span>报销单总数</span><b>{desk.reimbursementStats.total}<small> 单</small></b></div>
      <div><span>待审核</span><b>{desk.reimbursementStats.pendingReview}<small> 单 · {desk.money(desk.reimbursementStats.pendingReviewAmount)}</small></b></div>
      <div><span>待付款</span><b>{desk.reimbursementStats.pendingPay}<small> 单 · {desk.money(desk.reimbursementStats.pendingPayAmount)}</small></b></div>
      <div><span>已打回</span><b class="negative">{desk.reimbursementStats.rejected}<small> 单</small></b></div>
    {:else}
      <div><span>全部</span><b>{desk.reimbursementStats.total}<small> 单</small></b></div>
      <div><span>未完成</span><b>{desk.reimbursementStats.total - desk.reimbursementStats.paid}<small> 单</small></b></div>
      <div><span>已报销金额</span><b>{desk.money(desk.reimbursementRowsForRole.filter((item: any) => item.reimbursement_status === "已报销").reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0))}</b></div>
      <div><span>已打回</span><b class="negative">{desk.reimbursementStats.rejected}<small> 单</small></b></div>
    {/if}
  </div>
  {#if desk.reimbursementRole === "employee" && desk.reimbursementStats.rejected}
    <div class="reimbursement-callout"><b>有 {desk.reimbursementStats.rejected} 条报销需要补充资料</b><span>请查看打回原因并重新上传发票，上传后会重新进入财务核验队列。</span></div>
  {/if}
  <div class:finance-filters={desk.reimbursementRole === "finance"} class="filters reimbursement-filters" aria-label="报销筛选">
    {#if desk.reimbursementRole === "finance"}<label class="field"><span>员工</span><select bind:value={desk.reimbursementPerson}><option value="">全部员工</option>{#each desk.reimbursementPeople as person}<option value={person}>{person}</option>{/each}</select></label>{/if}
    <label class="field"><span>项目</span><select bind:value={desk.reimbursementProject}><option value="">全部项目</option>{#each desk.projects as project}<option value={project.id}>{project.name}</option>{/each}</select></label>
    <label class="field"><span>类型</span><select bind:value={desk.reimbursementType}><option value="">全部类型</option><option value="order">订单报销</option><option value="internal">内务报销</option></select></label>
    <label class="field"><span>状态</span><select bind:value={desk.reimbursementStatus}><option value="">{desk.reimbursementRole === "finance" ? "待处理" : "全部状态"}</option><option value="未报销">未报销</option><option value="待审核">待审核</option><option value="已打回">已打回</option><option value="待打款">待打款</option><option value="已报销">已报销</option></select></label>
    <label class="field"><span>开始日期</span><input class="date-input" type="date" bind:value={desk.reimbursementFrom} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
    <label class="field"><span>结束日期</span><input class="date-input" type="date" bind:value={desk.reimbursementTo} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
  </div>
  <div class="reimbursement-actions"><span class="role-context">当前：{desk.reimbursementRole === "finance" ? (desk.reimbursementPerson ? `${desk.reimbursementPerson} 的报销队列` : "全部员工的待处理报销") : `当前账号：${desk.creatorName || "未设置填写人"}`}</span>{#if desk.reimbursementRole === "finance"}<button class="outline-action" type="button" onclick={desk.exportReimbursements}>导出当前筛选</button>{/if}<button class="outline-action" type="button" onclick={desk.resetReimbursementFilters}>重置筛选</button>{#if desk.reimbursementRole === "finance"}<button class="outline-action" type="button" disabled={!desk.selectedPendingReviewCount || desk.busy} onclick={desk.batchReviewReimbursements}>批量审核通过（{desk.selectedPendingReviewCount}）</button><button class="delete-action" type="button" disabled={!desk.selectedPendingReviewCount || desk.busy} onclick={desk.batchRejectReimbursements}>批量打回（{desk.selectedPendingReviewCount}）</button>{/if}</div>
  {#if desk.reimbursementRole === "finance"}<div class="workflow-section-heading"><div><span class="workflow-step">1</span><div><b>审核报销</b><small>核对报销内容和附件，审核通过后进入待打款队列</small></div></div><strong>{desk.reimbursementStats.pendingReview} 笔待审核</strong></div>{/if}
  <div class="table-panel reimbursement-review-table">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>选择</th><th>来源订单</th><th>项目 / 垫付员工</th><th>垫付日期</th><th>垫付物品</th><th
              >金额</th
            ><th>备注附件</th><th>报销状态</th><th>操作</th></tr
          ></thead
        ><tbody
          >{#each desk.reimbursementRows() as item}<tr
              ><td><input type="checkbox" aria-label={`选择报销 ${item.advance_item || item.item}`} disabled={desk.reimbursementRole !== "finance" || !["待审核", "待打款"].includes(item.reimbursement_status)} checked={desk.selectedReimbursementIds.includes(item.id)} onchange={() => desk.toggleReimbursement(item.id)} /></td><td>{#if item.order_id}<button class="link-action" type="button" onclick={() => desk.openDetail(desk.orders.find((order: any) => order.id === item.order_id))}><b>{item.code}</b></button>{:else}<b class="muted">内务报销</b>{/if}</td><td
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
                ><span class:reimbursement-rejected={item.reimbursement_status === "已打回"} class="status-dot">{item.reimbursement_status}</span>{#if item.reimbursement_status === "已打回" && item.reject_reason}<small class="reject-reason">{item.reject_reason}</small>{/if}</td
              ><td
                >{#if item.voucher_no}<button class="link-action" type="button" onclick={() => detailItem = item}>查看单据</button>{:else if desk.reimbursementRole === "finance" && (item.reimbursement_status === "待打款" || item.reimbursement_status === "已报销")}<button class="link-action" type="button" disabled={desk.busy} onclick={() => desk.generateReimbursementVoucher(item)}>生成单据</button>{:else}<span class="muted">查看明细</span>{/if}<br />{#if desk.reimbursementRole === "employee"}{#if desk.canWrite && item.reimbursement_status === "已打回"}<button class="outline-action reupload-action" type="button" disabled={desk.busy} onclick={() => desk.reuploadReimbursement(item)}>重新上传发票</button>{:else}<span class="muted">{item.reimbursement_status === "待审核" ? "等待财务核验" : item.reimbursement_status === "待打款" ? "等待付款" : "已完成"}</span>{/if}{:else if item.reimbursement_status === "待审核"}<button
                    class="primary-action"
                    type="button"
                    disabled={desk.busy}
                    onclick={() => desk.markReimbursement(item, "待打款")}
                    >审核通过</button><button class="delete-action" type="button" disabled={desk.busy} onclick={() => desk.rejectReimbursement(item)}>打回</button
                  >{:else if item.reimbursement_status === "待打款"}<button
                    class="primary-action"
                    type="button"
                    disabled={desk.busy}
                    onclick={() => desk.markReimbursement(item, "已报销")}
                    >标记已报销</button
                  >{:else}<span class="muted">{item.reimbursement_status === "已打回" ? "等待员工补充发票" : "已完成"}</span>{/if}{#if desk.canWrite && desk.reimbursementRole === "employee" && item.reimbursement_status === "待审核"}<button class="delete-action" type="button" onclick={() => desk.deleteReimbursement(item)}>删除</button>{/if}</td
              ></tr
            >{#if attachmentsByOrder[item.id]?.length}<tr class="attachment-row"
                ><td colspan="9"
                  ><ul class="attachment-list">{#each attachmentsByOrder[item.id] as file}<li>
                        <button
                          class="attachment-link"
                          type="button"
                          onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}
                          title="在当前页面预览附件"
                          ><Paperclip size={13} />
                          <span class="attachment-name">{file.file_name}</span>
                          <small>{file.mime_type === "application/pdf" ? "PDF" : "图片"} · {desk.formatFileSize(file.file_size)}</small>
                        </button>
                      </li>{/each}</ul></td
                ></tr
              >{/if}{:else}<tr
              ><td colspan="9"
                ><div class="empty-table">暂无符合条件的待处理报销记录。</div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
  {#if desk.reimbursementRole === "finance"}
    <div class="workflow-section-heading payment-workflow-heading"><div><span class="workflow-step">2</span><div><b>报销打款</b><small>仅显示已审核通过、等待付款的报销记录</small></div></div><strong>{desk.reimbursementStats.pendingPay} 笔待打款</strong></div>
    <section class="finance-workbench payment-workbench" aria-label="待付款报销汇总">
      <div class="finance-workbench-head"><div><b>最近应付汇总单</b><span>可同时选择多个员工卡片，再批量确认已打款</span></div><div class="finance-head-actions">{#if desk.selectedPendingPaymentCount}<span class="payment-selected-total"><Check size={14} />已选择 {desk.selectedPendingPaymentCount} 笔</span>{/if}<strong>{desk.reimbursementStats.pendingPay} 笔 · {desk.money(desk.reimbursementStats.pendingPayAmount)}</strong><button class="outline-action" type="button" onclick={desk.exportPaymentSummary}>导出打款单</button><button class="primary-action payment-batch-action" type="button" disabled={!desk.selectedPendingPaymentCount || desk.busy} onclick={desk.batchMarkReimbursed}>批量确认已打款{desk.selectedPendingPaymentCount ? `（${desk.selectedPendingPaymentCount}）` : ''}</button></div></div>
      <div class="payment-summary-list">
        {#each desk.reimbursementPaymentSummary as group}
          {@const selectedCount = group.ids.filter((id: string) => desk.selectedReimbursementIds.includes(id)).length}
          {@const fullySelected = selectedCount === group.count}
          {@const partiallySelected = selectedCount > 0 && !fullySelected}
          <div class:payment-selected={fullySelected} class:payment-partial={partiallySelected} class="payment-summary-item">
            <button class="payment-summary-select" type="button" aria-pressed={fullySelected} onclick={() => desk.selectEmployeePayments(group.employee)}>
              <span class="payment-selection-icon" aria-hidden="true">{#if fullySelected}<Check size={16} strokeWidth={3} />{:else if partiallySelected}<CircleDot size={17} />{:else}<Circle size={17} />{/if}</span>
              <span class="payment-summary-person"><b>{group.employee}</b><small>{fullySelected ? `已选择 ${group.count} 笔` : partiallySelected ? `已选择 ${selectedCount} / ${group.count} 笔` : `${group.count} 笔待付款`}</small></span>
              <strong>{desk.money(group.amount)}</strong>
            </button>
            <button class="outline-action payment-confirm-action" type="button" disabled={desk.busy} onclick={() => desk.markEmployeeReimbursed(group.employee)}>确认已打款</button>
          </div>
        {:else}<div class="empty-workbench">暂无待付款报销。</div>
        {/each}
      </div>
    </section>
    <details class="finance-workbench voucher-archive">
      <summary class="finance-workbench-head"><div><b>单据存档</b><span>已确认和已完成报销的可追溯记录</span></div><div class="archive-summary-meta"><strong>{desk.reimbursementStats.paid} 笔已报销</strong><span class="archive-toggle-label">展开存档</span></div></summary>
      <div class="table-panel archive-table"><div class="table-scroll"><table><thead><tr><th>单据编号</th><th>报销人</th><th>报销物品</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>{#each desk.reimbursementVouchers as voucher}<tr><td><b>{voucher.voucherNo}</b><small>{voucher.advance_date}</small></td><td>{voucher.employee}</td><td>{voucher.advance_item || voucher.item}</td><td class="money">{desk.money(voucher.advance_amount)}</td><td><span class="status-dot">{voucher.reimbursement_status}</span></td><td><button class="link-action" type="button" onclick={() => detailItem = voucher}>查看单据</button><a class="link-action" href={`/api/reimbursements/export?mode=voucher&ids=${encodeURIComponent(voucher.id)}&actor=${encodeURIComponent(desk.creatorName || '财务人员')}`}>下载</a>{#if voucher.voucher_archived_at}<small class="muted">已归档</small>{:else}<button class="outline-action" type="button" disabled={desk.busy} onclick={() => desk.archiveReimbursementVoucher(voucher)}>归档</button>{/if}</td></tr>{:else}<tr><td colspan="6"><div class="empty-table">尚无已确认的报销单据。</div></td></tr>{/each}</tbody></table></div></div>
    </details>
  {/if}
  {#if detailItem}
    <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailItem = null; }}>
      <div class="export-drawer reimbursement-detail" role="dialog" aria-modal="true" aria-labelledby="reimbursement-detail-title">
        <div class="drawer-head"><div><p class="section-kicker">REIMBURSEMENT VOUCHER</p><h2 id="reimbursement-detail-title">报销单据</h2><span>{detailItem.source_type || "订单报销"} · {detailItem.reimbursement_status}</span></div><button class="icon-control" aria-label="关闭报销单据" onclick={() => detailItem = null}><X size={18} /></button></div>
        <div class="drawer-body"><div class="voucher-grid"><div><small>报销人</small><b>{detailItem.employee}</b></div><div><small>报销物品</small><b>{detailItem.advance_item || detailItem.item}</b></div><div><small>报销金额</small><b>{desk.money(detailItem.advance_amount)}</b></div><div><small>垫付日期</small><b>{detailItem.advance_date}</b></div><div><small>关联订单</small><b>{detailItem.code || "内务报销"}</b></div><div><small>客户 / 项目</small><b>{detailItem.customer_name ? `${detailItem.customer_name} · ` : ""}{detailItem.project_name || "内务报销"}</b></div><div class="voucher-full"><small>发票附件</small>{#if detailItem.attachment_count}<button class="link-action voucher-attachment-button" type="button" onclick={() => showAttachments(detailItem)}>{detailItem.invoice || "查看附件"} · {detailItem.attachment_count} 个</button>{:else}<b>{detailItem.invoice || "未上传"}</b>{/if}{#if attachmentsByOrder[detailItem.id]?.length}<ul class="voucher-attachments">{#each attachmentsByOrder[detailItem.id] as file}<li><button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}><Paperclip size={13}/><span>{file.file_name}</span><small>{desk.formatFileSize(file.file_size)}</small></button></li>{/each}</ul>{/if}</div>{#if detailItem.reimbursement_status === "已打回"}<div class="voucher-full rejection-detail"><small>打回原因</small><b>{detailItem.reject_reason || "请补充发票资料"}</b></div>{/if}<div class="voucher-full"><small>备注</small><b>{detailItem.note || "—"}</b></div></div></div>
        <div class="drawer-footer"><button class="outline-action" type="button" onclick={() => detailItem = null}>关闭</button></div>
      </div>
    </div>
  {/if}
</section>
