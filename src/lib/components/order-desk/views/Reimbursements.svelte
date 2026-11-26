<script lang="ts">
  import { getContext } from "svelte";
  import { appPath } from "$lib/api";
  import { reimbursementWorkflow } from '$lib/permissions';
  import { Download, Eye, FileText, Paperclip, Plus, Trash2, Upload, Wrench, X } from "lucide-svelte";
  import WorkbenchListFilters from '../WorkbenchListFilters.svelte';
  import ProofUploadModal from '../ProofUploadModal.svelte';
  import AmountChangeModal from '../AmountChangeModal.svelte';
  import { formatInBizTZ } from '$lib/time';
  import ReimbursementStatus from '../ReimbursementStatus.svelte';
  const desk = getContext<any>("order-desk");
  let { mode = "mine" }: { mode?: "mine" | "review" } = $props();

  let attachmentsByOrder = $state<Record<string, Array<any>>>({});
  let detailItem = $state<any>(null);
  let proofItem = $state<any>(null);
  let amountItem = $state<any>(null);
  let selectionMode = $state(false);
  const selectedEmployee = $derived(desk.reimbursementPerson);
  const isReviewer = $derived(mode === "review");
  const canBatchAct = $derived(isReviewer && Boolean(desk.canReviewReimbursements));
  const batchApproveLabel = $derived.by(() => {
    const byTarget: Record<string, string> = { "待二级审核": "统一审核", "待三级审核": "统一复核", "待执行": "统一确认", "已执行": "统一报销" };
    const targets = desk.selectedApprovableTargets as string[];
    if (targets.length === 1) return byTarget[targets[0]] || "统一审核";
    return "统一审核";
  });
  // 服务端逐条按部门配置裁剪队列，筛选项覆盖三级审核和财务执行节点。
  const responsibleStatuses = $derived(reimbursementWorkflow.map((step) => step.status));
  const rows = $derived.by(() => {
    desk.reimbursementRefreshVersion;
    return desk.reimbursementRows();
  });
  // 报销人选项保持完整，便于在筛选后切换人员。
  const reviewQueue = $derived.by(() => {
    desk.reimbursementRefreshVersion;
    return desk.reviewReimbursements;
  });
  const employeeQueues = $derived(
    [...new Set<string>(reviewQueue.map((item: any) => String(item.employee || "")).filter(Boolean))]
      .map((employee) => ({ employee, count: reviewQueue.filter((item: any) => item.employee === employee).length }))
      .sort((a, b) => b.count - a.count || String(a.employee).localeCompare(String(b.employee), "zh-CN")),
  );
  const visibleRows = $derived(
    isReviewer && selectedEmployee ? rows.filter((item: any) => item.employee === selectedEmployee) : rows,
  );
  const selectableRows = $derived(visibleRows.filter((item: any) => item.can_act && item.next_status));
  const allVisibleSelected = $derived(selectableRows.length > 0 && selectableRows.every((item: any) => desk.selectedReimbursementIds.includes(item.id)));
  const someVisibleSelected = $derived(selectableRows.some((item: any) => desk.selectedReimbursementIds.includes(item.id)));
  function toggleVisibleSelection() {
    const ids = selectableRows.map((item: any) => item.id);
    desk.selectedReimbursementIds = allVisibleSelected
      ? desk.selectedReimbursementIds.filter((id: string) => !ids.includes(id))
      : [...new Set([...desk.selectedReimbursementIds, ...ids])];
  }
  const pendingCount = $derived(visibleRows.length);
  const pendingAmount = $derived(visibleRows.reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0));
  const statusLabels: Record<string, string> = {
    '待上传证明': '待上传证明', '待一级审核': '一级审核', '待二级审核': '二级审核',
    '待三级审核': '三级审核', '待执行': '待执行',
  };
  const filterFields = $derived([
    { key: 'reimbursementProject', label: '项目', value: desk.reimbursementProject, options: [{ value: '', label: '全部项目' }, ...desk.projects.map((item: any) => ({ value: item.id, label: item.name }))] },
    ...(isReviewer ? [{ key: 'employee', label: '报销人', value: selectedEmployee, options: [{ value: '', label: '全部报销人' }, ...employeeQueues.map((item) => ({ value: item.employee, label: `${item.employee}（${item.count}）` }))] }] : []),
    { key: 'reimbursementType', label: '类型', value: desk.reimbursementType, options: [{ value: '', label: '全部类型' }, { value: 'order', label: '订单报销' }, { value: 'internal', label: '内务报销' }] },
    { key: 'reimbursementStatus', label: '状态', value: desk.reimbursementStatus, options: [{ value: '', label: '全部状态' }, ...(isReviewer ? responsibleStatuses : ['待上传证明', '待一级审核', '待二级审核', '待三级审核', '待执行', '已执行', '已打回']).map((value) => ({ value, label: statusLabels[value] || value }))] },
    { key: 'reimbursementFrom', label: '垫付日期', type: 'date-range' as const, value: desk.reimbursementFrom, endKey: 'reimbursementTo', endValue: desk.reimbursementTo },
  ]);
  function changeFilter(key: string, value: string) {
    if (key === 'employee') desk.reimbursementPerson = value;
    else desk[key] = value;
  }
  function clearFilters() { desk.resetReimbursementFilters(); }
  const steps = ["提交报销", "一级审核", "二级审核", "三级审核", "财务执行"];
  // 当前所处节点：之前的步骤标记为已完成，当前节点单独高亮，已执行时全部完成。
  const progressIndex: Record<string, number> = { "待上传证明": 0, "待一级审核": 1, "待二级审核": 2, "待三级审核": 3, "待执行": 4, "已执行": 5, "已打回": 0 };
  function approvalActionLabel(action: string) {
    return ({ approved: '审核通过', rejected: '打回', executed: '确认执行', resubmitted: '重新提交', submitted: '提交报销', content_modified: '修改退回' } as Record<string, string>)[action] || action;
  }
  function approvalLayerLabel(layer: number, action = '') {
    if (action === 'content_modified' && layer === 0) return '内容修改';
    if (layer === 0) return '提交';
    if (layer >= 4) return '执行';
    return `${layer}级审核`;
  }
  function canRequestAmountChange(item: any) {
    return !isReviewer && item.employee_uid === desk.identity?.uid && item.reimbursement_status !== "已执行";
  }
  function leaveSelectionMode() {
    selectionMode = false;
    desk.selectedReimbursementIds = [];
  }
  async function showAttachments(item: any) {
    const reimbursementId = item.id;
    if (attachmentsByOrder[reimbursementId]) {
      const next = { ...attachmentsByOrder };
      delete next[reimbursementId];
      attachmentsByOrder = next;
      return;
    }
    try {
      const response = await fetch(appPath(`/api/reimbursements/${encodeURIComponent(reimbursementId)}/attachments`));
      if (!response.ok) throw new Error("附件加载失败");
      const files = (await response.json()).data;
      attachmentsByOrder = { ...attachmentsByOrder, [reimbursementId]: files };
    } catch {
      attachmentsByOrder = { ...attachmentsByOrder, [reimbursementId]: [] };
    }
  }
</script>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape' && !proofItem && !amountItem) detailItem = null; }} />

<section class="page-section workbench-list-page reimbursement-page" class:review-page={isReviewer} class:selection-mode={selectionMode}>
  <div class="section-heading">
    <div>
      <p class="section-kicker">{isReviewer ? "报销审核" : "我的报销"}</p>
      <h2>{isReviewer ? "待我处理的报销" : "我的报销"}</h2>
    </div>
    <div class="top-actions">{#if !isReviewer}<button class="primary-action" type="button" onclick={desk.openStandaloneReimbursement}><Plus size={15} />报销录入</button>{/if}</div>
  </div>
  <WorkbenchListFilters fields={filterFields} onchange={changeFilter} onclear={clearFilters} label="报销筛选" disabled={desk.busy} />
  {#if !isReviewer}
  <div class="workbench-statistics">
  <div class="workbench-statistics-head"><span>当前筛选结果 · {pendingCount} 笔报销</span></div>
  <div class="summary-row reimbursement-summary summary-row-five">
      <div><span>全部</span><b>{desk.reimbursementStats.total}<small> 单</small></b></div>
      <div><span>待上传证明</span><b class="proof-stat">{desk.reimbursementStats.pendingProof}<small> 单</small></b></div>
      <div><span>未完成</span><b>{desk.reimbursementStats.total - desk.reimbursementStats.paid}<small> 单</small></b></div>
      <div><span>已执行金额</span><b>{desk.money(visibleRows.filter((item: any) => item.reimbursement_status === "已执行").reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0))}</b></div>
      <div><span>已打回</span><b class="negative">{desk.reimbursementStats.rejected}<small> 单</small></b></div>
  </div>
  </div>
  {/if}
  <div class="table-tools workbench-table-tools">
    <div class="order-table-heading"><h3>{isReviewer ? '审核明细' : '报销明细'}</h3><span class="filter-result">共 {pendingCount} 笔{#if isReviewer}<span class="review-amount-summary">合计 <b>{desk.money(pendingAmount)}</b></span>{/if}</span></div>
    <div class="table-actions">
      {#if isReviewer && ["finance", "admin"].includes(desk.identity?.role)}<button class="outline-action" type="button" onclick={desk.exportReimbursements}><Download size={15} />导出当前筛选</button>{/if}
      {#if canBatchAct}
        {#if !selectionMode}
          <button class="outline-action batch-mode-toggle" type="button" aria-pressed={selectionMode} disabled={desk.busy} onclick={() => selectionMode = true}>多选</button>
        {/if}
      {/if}
    </div>
  </div>
  {#if canBatchAct && selectionMode}
    <div class="order-bulk-toolbar" aria-label="批量报销操作" aria-busy={desk.busy}>
      <label class="bulk-page-select"><input type="checkbox" aria-label="全选当前筛选报销" checked={allVisibleSelected} indeterminate={someVisibleSelected && !allVisibleSelected} disabled={desk.busy || !selectableRows.length} onchange={toggleVisibleSelection} /><span>全选当前筛选</span></label>
      <span class="bulk-count" aria-live="polite">已选 {desk.selectedApprovableCount} 项</span>
      <div class="bulk-actions">
        <button class="primary-action batch-mode-action" type="button" disabled={!desk.selectedApprovableCount || desk.busy} onclick={desk.batchAdvanceReimbursements}>{batchApproveLabel}（{desk.selectedApprovableCount}）</button>
        <button class="delete-action batch-reject-action" type="button" disabled={!desk.selectedRejectableCount || desk.busy} onclick={desk.batchRejectReimbursements}>统一打回（{desk.selectedRejectableCount}）</button>
        <button class="outline-action batch-cancel-action" type="button" disabled={desk.busy} onclick={leaveSelectionMode}>退出选择</button>
      </div>
    </div>
  {/if}
  {#if !isReviewer && desk.reimbursementStats.pendingProof}
    <div class="reimbursement-callout proof-callout"><b>有 {desk.reimbursementStats.pendingProof} 条垫付待上传证明，合计 {desk.money(desk.reimbursementStats.pendingProofAmount)}</b><span>请上传实际付款截图和对应发票，两项齐全后点击【提交】进入审批流程。</span></div>
  {/if}
  {#if !isReviewer && desk.reimbursementStats.rejected}
    <div class="reimbursement-callout"><b>有 {desk.reimbursementStats.rejected} 条报销需要补充资料</b><span>请查看打回原因并重新上传发票，上传后会重新进入审核队列。</span></div>
  {/if}
  <div class="table-panel reimbursement-review-table">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            >{#if isReviewer && selectionMode}<th><input type="checkbox" aria-label="全选列表报销" checked={allVisibleSelected} indeterminate={someVisibleSelected && !allVisibleSelected} disabled={desk.busy || !selectableRows.length} onchange={toggleVisibleSelection} /></th>{/if}<th>来源订单</th><th>项目垫付</th><th>垫付日期</th><th>垫付物品</th><th
              >金额</th
            ><th>备注附件</th><th>报销状态</th><th>操作</th></tr
          ></thead
        ><tbody
          >{#each visibleRows as item}{@const action = isReviewer && item.can_act && item.next_status ? { target: item.next_status, label: item.next_action_label || "审核通过" } : null}<tr
              >{#if isReviewer && selectionMode}<td><input type="checkbox" aria-label={`选择报销 ${item.advance_item || item.item}`} disabled={!action || desk.busy} checked={desk.selectedReimbursementIds.includes(item.id)} onchange={() => desk.toggleReimbursement(item.id)} /></td>{/if}<td>{#if item.order_id}<button class="link-action" type="button" onclick={() => desk.openDetail(desk.orders.find((order: any) => order.id === item.order_id))}><b>{item.code}</b></button>{:else}<b class="muted">内务报销</b>{/if}</td><td
                ><b>{item.project_name}</b></td
              ><td>{item.advance_date}</td><td>{item.advance_item || "—"}</td><td
                class="money"><div class="reimbursement-amount-cell"><span>{desk.money(item.advance_amount)}</span>{#if item.content_modified}<span class="reimbursement-modified-badge" title={item.amount_change_note || "报销内容修改过"}>已修改</span>{/if}{#if canRequestAmountChange(item)}<button class="link-action amount-change-action" type="button" disabled={desk.busy} onclick={() => amountItem = item}>申请修改金额</button>{/if}</div></td
              ><td
                ><div class="reimbursement-attachment-cell">{#if item.attachment_count}<button
                    class="attachment-toggle"
                    title="展开附件列表"
                    onclick={() => showAttachments(item)}
                    ><Paperclip size={14} />{item.attachment_count} 个</button
                  >{/if}{#if !isReviewer && item.employee_uid === desk.identity?.uid && item.reimbursement_status === "待上传证明"}<button
                    class="attachment-toggle proof-upload-entry"
                    type="button"
                    title="上传付款截图和发票"
                    disabled={desk.busy}
                    onclick={() => proofItem = item}
                    ><Upload size={14} />{item.attachment_count ? "继续上传" : "上传"}</button
                  >{:else if !item.attachment_count}<span class="muted attachment-none"><Paperclip size={14} /> 未上传</span
                  >{/if}</div></td
              ><td
                ><div class="reimbursement-row-status" title={isReviewer && item.current_approvers?.length ? `当前节点审核人：${item.current_approvers.map((approver: any) => approver.name).join("、")}` : undefined}><ReimbursementStatus status={item.reimbursement_status} compact /></div></td
              ><td
                ><div class="reimbursement-row-actions">
                  <button class="icon-control" type="button" title="查看详情" aria-label={`查看报销详情：${item.advance_item || item.item}`} onclick={() => detailItem = item}><Eye size={16} /></button>
                  {#if !isReviewer && item.employee_uid === desk.identity?.uid && item.reimbursement_status === "已打回"}<button class="icon-control reimbursement-repair-icon" type="button" title="补充发票" aria-label={`补充发票：${item.advance_item || item.item}`} disabled={desk.busy} onclick={() => desk.reuploadReimbursement(item)}><Wrench size={16} /></button>{/if}
                  {#if action}<button class="primary-action reimbursement-action" type="button" disabled={desk.busy} onclick={() => desk.markReimbursement(item, action.target)}>{action.label}</button>{/if}
                  {#if !item.voucher_no && ["finance", "admin"].includes(desk.identity?.role) && (item.reimbursement_status === "待执行" || item.reimbursement_status === "已执行")}<button class="icon-control" type="button" title="生成单据" aria-label={`生成报销单据：${item.advance_item || item.item}`} disabled={desk.busy} onclick={() => desk.generateReimbursementVoucher(item)}><FileText size={16} /></button>{/if}
                  {#if isReviewer && item.can_reject}<button class="delete-action reimbursement-reject-action" type="button" title="打回报销" aria-label={`打回报销：${item.advance_item || item.item}`} disabled={desk.busy} onclick={() => desk.rejectReimbursement(item)}><X size={16} /></button>{/if}
                  {#if !isReviewer && item.employee_uid === desk.identity?.uid && ["待上传证明", "待一级审核"].includes(item.reimbursement_status)}<button class="delete-action reimbursement-danger-icon" type="button" title="删除报销" aria-label={`删除报销：${item.advance_item || item.item}`} disabled={desk.busy} onclick={() => desk.deleteReimbursement(item)}><Trash2 size={16} /></button>{/if}
                </div></td
              ></tr
            >{#if attachmentsByOrder[item.id]?.length}<tr class="attachment-row"
                ><td colspan={isReviewer && selectionMode ? 9 : 8}
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
              ><td colspan={isReviewer && selectionMode ? 9 : 8}
                ><div class="empty-table">{filterFields.some((field) => field.value || field.endValue) ? '没有符合筛选条件的报销。' : isReviewer ? "暂无需要当前角色处理的报销。" : "你还没有提交过报销记录。"}{#if filterFields.some((field) => field.value || field.endValue)}<button class="outline-action" type="button" onclick={clearFilters}>清空筛选</button>{:else if !isReviewer}<button class="outline-action" type="button" onclick={desk.openStandaloneReimbursement}><Plus size={15} />报销录入</button>{/if}</div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
  {#if proofItem}
    <ProofUploadModal item={proofItem} onclose={() => proofItem = null} onsubmitted={() => proofItem = null} />
  {/if}
  {#if amountItem}
    <AmountChangeModal item={amountItem} onclose={() => amountItem = null} onchanged={() => amountItem = null} />
  {/if}
  {#if detailItem}
    <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailItem = null; }}>
      <div class="export-drawer reimbursement-detail" role="dialog" aria-modal="true" aria-labelledby="reimbursement-detail-title">
        <div class="drawer-head"><div><p class="section-kicker">报销单据</p><h2 id="reimbursement-detail-title">报销单据</h2><span>{detailItem.source_type || "订单报销"} · {detailItem.reimbursement_status}</span></div><button class="icon-control" aria-label="关闭报销单据" onclick={() => detailItem = null}><X size={18} /></button></div>
        <div class="drawer-body"><ol class="reimbursement-progress" aria-label="报销进度">{#each steps as step, index}{@const activeIndex = progressIndex[detailItem.reimbursement_status] ?? 0}<li class:completed={index < activeIndex} class:current={index === activeIndex} aria-current={index === activeIndex ? "step" : undefined}><span>{index + 1}</span>{step}</li>{/each}</ol><div class="voucher-grid"><div><small>报销人</small><b>{detailItem.employee}</b></div><div><small>报销物品</small><b>{detailItem.advance_item || detailItem.item}</b></div><div><small>报销金额</small><b>{desk.money(detailItem.advance_amount)}</b></div><div><small>垫付日期</small><b>{detailItem.advance_date}</b></div><div><small>关联订单</small><b>{detailItem.code || "内务报销"}</b></div><div><small>客户 / 项目</small><b>{detailItem.customer_name ? `${detailItem.customer_name} · ` : ""}{detailItem.project_name || "内务报销"}</b></div><div><small>所属部门</small><b>{detailItem.department || "未设置"}</b></div>{#if detailItem.current_approvers?.length}<div class="voucher-full"><small>当前审核人</small><b>{detailItem.using_default_approvers ? "默认：" : ""}{detailItem.current_approvers.map((approver: any) => approver.name).join("、")}</b></div>{/if}<div class="voucher-full"><small>发票附件</small>{#if detailItem.attachment_count}<button class="link-action voucher-attachment-button" type="button" onclick={() => showAttachments(detailItem)}>{detailItem.invoice || "查看附件"} · {detailItem.attachment_count} 个</button>{:else}<b>{detailItem.invoice || "未上传"}</b>{/if}{#if attachmentsByOrder[detailItem.id]?.length}<ul class="voucher-attachments">{#each attachmentsByOrder[detailItem.id] as file}<li><button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}><Paperclip size={13}/><span>{file.file_name}</span><small>{desk.formatFileSize(file.file_size)}</small></button></li>{/each}</ul>{/if}</div>{#if detailItem.reimbursement_status === "已打回"}<div class="voucher-full rejection-detail"><small>打回原因</small><b>{detailItem.reject_reason || "请补充发票资料"}</b></div>{/if}<div class="voucher-full"><small>备注</small><b>{detailItem.note || "—"}</b></div>{#if detailItem.content_modified}<div class="voucher-full reimbursement-modified-detail"><small>内容修改</small><b>{detailItem.amount_change_note || "报销内容已修改"}{detailItem.content_modified_at ? ` · ${formatInBizTZ(detailItem.content_modified_at)}` : ""}</b></div>{/if}{#if detailItem.approval_history?.length}<div class="voucher-full approval-history"><small>审批记录</small><ul>{#each detailItem.approval_history as record}<li><b>{approvalLayerLabel(record.layer, record.action)}</b><span>{record.approver_name || "系统"} · {approvalActionLabel(record.action)}</span><small>{formatInBizTZ(record.created_at)}{record.comment ? ` · ${record.comment}` : ""}</small></li>{/each}</ul></div>{/if}</div></div>
      </div>
    </div>
  {/if}
</section>
