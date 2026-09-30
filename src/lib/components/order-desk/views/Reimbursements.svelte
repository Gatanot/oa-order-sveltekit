<script lang="ts">
  import { getContext } from "svelte";
  import { appPath } from "$lib/api";
  import { Paperclip, X } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
  let { mode = "mine" }: { mode?: "mine" | "review" } = $props();

  let attachmentsByOrder = $state<Record<string, Array<any>>>({});
  let detailItem = $state<any>(null);
  let selectedEmployee = $state("");
  const isReviewer = $derived(mode === "review");
  // 服务端已按角色裁剪审核队列，这里只用于展示统计。
  const responsibleStatuses = $derived(
    desk.identity?.role === "manager" ? ["已提交待审核"] :
    desk.identity?.role === "finance" ? ["已审核待复核", "已确认待执行"] :
    desk.identity?.role === "owner" ? ["已复核待确认"] :
    desk.identity?.role === "admin" ? ["已提交待审核", "已审核待复核", "已复核待确认", "已确认待执行"] : [],
  );
  const rows = $derived.by(() => {
    desk.reimbursementRefreshVersion;
    return desk.reimbursementRows();
  });
  // 审核队列不随筛选变化，保证各状态数量始终可见。
  const reviewQueue = $derived.by(() => {
    desk.reimbursementRefreshVersion;
    return desk.reviewReimbursements;
  });
  const employeeQueues = $derived(
    [...new Set<string>(rows.map((item: any) => String(item.employee || "")).filter(Boolean))]
      .map((employee) => ({ employee, count: rows.filter((item: any) => item.employee === employee).length }))
      .sort((a, b) => b.count - a.count || String(a.employee).localeCompare(String(b.employee), "zh-CN")),
  );
  const visibleRows = $derived(
    isReviewer && selectedEmployee ? rows.filter((item: any) => item.employee === selectedEmployee) : rows,
  );
  const responsibleAmount = $derived(reviewQueue.reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0));
  const steps = ["提交报销", "管理人审核", "财务复核", "老板确认", "财务执行"];
  const progress: Record<string, number> = { "已提交待审核": 1, "已审核待复核": 2, "已复核待确认": 3, "已确认待执行": 4, "已执行": 5, "已打回": 1 };
  function nextAction(status: string, role: string) {
    if (status === "已提交待审核" && role === "manager") return { label: "审核通过", target: "已审核待复核" };
    if (status === "已审核待复核" && role === "finance") return { label: "复核通过", target: "已复核待确认" };
    if (status === "已复核待确认" && role === "owner") return { label: "确认报销", target: "已确认待执行" };
    if (status === "已确认待执行" && role === "finance") return { label: "确认已执行", target: "已执行" };
    return null;
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
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') detailItem = null; }} />

<section class="page-section">
  <div class="section-heading">
    <div>
      <p class="section-kicker">{isReviewer ? "报销审核" : "我的报销"}</p>
      <h2>{isReviewer ? "待我处理的报销" : "我的报销"}</h2>
      <span>{isReviewer ? "仅显示当前角色负责审批节点的报销。" : "提交和查看本人报销，并跟进当前处理进度。"}</span>
    </div>
    <div class="top-actions">{#if !isReviewer}<button class="primary-action" type="button" onclick={desk.openStandaloneReimbursement}><Paperclip size={15} />报销录入</button>{/if}</div>
  </div>
  <div class="summary-row reimbursement-summary">
    {#if isReviewer}
      <div><span>待我处理</span><b>{reviewQueue.length}<small> 单</small></b></div>
      <div><span>待处理金额</span><b>{desk.money(responsibleAmount)}</b></div>
      {#each responsibleStatuses as status}<div><span>{status}</span><b>{reviewQueue.filter((item: any) => item.reimbursement_status === status).length}<small> 单</small></b></div>{/each}
    {:else}
      <div><span>全部</span><b>{desk.reimbursementStats.total}<small> 单</small></b></div>
      <div><span>未完成</span><b>{desk.reimbursementStats.total - desk.reimbursementStats.paid}<small> 单</small></b></div>
      <div><span>已执行金额</span><b>{desk.money(desk.reimbursements.filter((item: any) => item.reimbursement_status === "已执行").reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0))}</b></div>
      <div><span>已打回</span><b class="negative">{desk.reimbursementStats.rejected}<small> 单</small></b></div>
    {/if}
  </div>
  {#if !isReviewer && desk.reimbursementStats.rejected}
    <div class="reimbursement-callout"><b>有 {desk.reimbursementStats.rejected} 条报销需要补充资料</b><span>请查看打回原因并重新上传发票，上传后会重新进入审核队列。</span></div>
  {/if}
  <div class:finance-filters={isReviewer} class="filters reimbursement-filters" aria-label="报销筛选">
    <label class="field"><span>项目</span><select bind:value={desk.reimbursementProject}><option value="">全部项目</option>{#each desk.projects as project}<option value={project.id}>{project.name}</option>{/each}</select></label>
    <label class="field"><span>类型</span><select bind:value={desk.reimbursementType}><option value="">全部类型</option><option value="order">订单报销</option><option value="internal">内务报销</option></select></label>
    <label class="field"><span>状态</span><select bind:value={desk.reimbursementStatus}><option value="">全部状态</option>{#if isReviewer}{#each responsibleStatuses as status}<option value={status}>{status}</option>{/each}{:else}<option value="未报销">未报销</option><option value="已提交待审核">已提交待审核</option><option value="已审核待复核">已审核待复核</option><option value="已复核待确认">已复核待确认</option><option value="已确认待执行">已确认待执行</option><option value="已执行">已执行</option><option value="已打回">已打回</option>{/if}</select></label>
    <label class="field"><span>开始日期</span><input class="date-input" type="date" bind:value={desk.reimbursementFrom} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
    <label class="field"><span>结束日期</span><input class="date-input" type="date" bind:value={desk.reimbursementTo} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
  </div>
  <div class="reimbursement-actions"><span class="role-context">当前：{isReviewer ? (selectedEmployee || "全部待处理报销") : `当前账号：${desk.creatorName || "未识别账号"}`}</span>{#if isReviewer && ["finance", "admin"].includes(desk.identity?.role)}<button class="outline-action" type="button" onclick={desk.exportReimbursements}>导出当前筛选</button>{/if}<button class="outline-action" type="button" onclick={() => { selectedEmployee = ""; desk.resetReimbursementFilters(); }}>重置筛选</button>{#if isReviewer && desk.identity?.role === "manager"}<button class="outline-action" type="button" disabled={!desk.selectedPendingReviewCount || desk.busy} onclick={desk.batchReviewReimbursements}>批量审核通过（{desk.selectedPendingReviewCount}）</button><button class="delete-action" type="button" disabled={!desk.selectedPendingReviewCount || desk.busy} onclick={desk.batchRejectReimbursements}>批量打回（{desk.selectedPendingReviewCount}）</button>{/if}</div>
  <div class:review-queue-layout={isReviewer}>
    {#if isReviewer}<aside class="review-person-tabs" aria-label="按报销人筛选"><button class:active={selectedEmployee === ""} type="button" onclick={() => { selectedEmployee = ""; desk.selectedReimbursementIds = []; }}><span>全部</span><b>{rows.length}</b></button>{#each employeeQueues as queue}<button class:active={selectedEmployee === queue.employee} type="button" onclick={() => { selectedEmployee = queue.employee; desk.selectedReimbursementIds = []; }}><span>{queue.employee}</span><b>{queue.count}</b></button>{/each}</aside>{/if}
  <div class="table-panel reimbursement-review-table">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            >{#if isReviewer}<th>选择</th>{/if}<th>来源订单</th><th>项目垫付</th><th>垫付日期</th><th>垫付物品</th><th
              >金额</th
            ><th>备注附件</th><th>报销状态</th><th>操作</th></tr
          ></thead
        ><tbody
          >{#each visibleRows as item}{@const action = isReviewer ? nextAction(item.reimbursement_status, desk.identity?.role) : null}<tr
              >{#if isReviewer}<td><input type="checkbox" aria-label={`选择报销 ${item.advance_item || item.item}`} disabled={!action} checked={desk.selectedReimbursementIds.includes(item.id)} onchange={() => desk.toggleReimbursement(item.id)} /></td>{/if}<td>{#if item.order_id}<button class="link-action" type="button" onclick={() => desk.openDetail(desk.orders.find((order: any) => order.id === item.order_id))}><b>{item.code}</b></button>{:else}<b class="muted">内务报销</b>{/if}</td><td
                ><b>{item.project_name}</b></td
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
                >{#if item.voucher_no}<button class="link-action" type="button" onclick={() => detailItem = item}>查看单据</button>{:else if ["finance", "admin"].includes(desk.identity?.role) && (item.reimbursement_status === "已确认待执行" || item.reimbursement_status === "已执行")} <button class="link-action" type="button" disabled={desk.busy} onclick={() => desk.generateReimbursementVoucher(item)}>生成单据</button>{:else}<button class="link-action" type="button" onclick={() => detailItem = item}>查看进度</button>{/if}<br />{#if !isReviewer && item.employee_uid === desk.identity?.uid && item.reimbursement_status === "已打回"}<button class="outline-action reupload-action" type="button" disabled={desk.busy} onclick={() => desk.reuploadReimbursement(item)}>重新上传发票</button>{/if}{#if action}<button class="primary-action" type="button" disabled={desk.busy} onclick={() => desk.markReimbursement(item, action.target)}>{action.label}</button>{/if}{#if isReviewer && desk.canManageReimbursements && ["已提交待审核", "已审核待复核", "已复核待确认"].includes(item.reimbursement_status) && action}<button class="delete-action" type="button" disabled={desk.busy} onclick={() => desk.rejectReimbursement(item)}>打回</button>{/if}{#if !isReviewer && item.employee_uid === desk.identity?.uid && item.reimbursement_status === "已提交待审核"}<button class="delete-action" type="button" onclick={() => desk.deleteReimbursement(item)}>删除</button>{/if}</td
              ></tr
            >{#if attachmentsByOrder[item.id]?.length}<tr class="attachment-row"
                ><td colspan={isReviewer ? 9 : 8}
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
              ><td colspan={isReviewer ? 9 : 8}
                ><div class="empty-table">{isReviewer ? "暂无需要当前角色处理的报销。" : "你还没有提交过报销记录。"}</div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
  </div>
  {#if detailItem}
    <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailItem = null; }}>
      <div class="export-drawer reimbursement-detail" role="dialog" aria-modal="true" aria-labelledby="reimbursement-detail-title">
        <div class="drawer-head"><div><p class="section-kicker">报销单据</p><h2 id="reimbursement-detail-title">报销单据</h2><span>{detailItem.source_type || "订单报销"} · {detailItem.reimbursement_status}</span></div><button class="icon-control" aria-label="关闭报销单据" onclick={() => detailItem = null}><X size={18} /></button></div>
        <div class="drawer-body"><ol class="reimbursement-progress" aria-label="报销进度">{#each steps as step, index}<li class:completed={index < (progress[detailItem.reimbursement_status] || 0)}><span>{index + 1}</span>{step}</li>{/each}</ol><div class="voucher-grid"><div><small>报销人</small><b>{detailItem.employee}</b></div><div><small>报销物品</small><b>{detailItem.advance_item || detailItem.item}</b></div><div><small>报销金额</small><b>{desk.money(detailItem.advance_amount)}</b></div><div><small>垫付日期</small><b>{detailItem.advance_date}</b></div><div><small>关联订单</small><b>{detailItem.code || "内务报销"}</b></div><div><small>客户 / 项目</small><b>{detailItem.customer_name ? `${detailItem.customer_name} · ` : ""}{detailItem.project_name || "内务报销"}</b></div><div class="voucher-full"><small>发票附件</small>{#if detailItem.attachment_count}<button class="link-action voucher-attachment-button" type="button" onclick={() => showAttachments(detailItem)}>{detailItem.invoice || "查看附件"} · {detailItem.attachment_count} 个</button>{:else}<b>{detailItem.invoice || "未上传"}</b>{/if}{#if attachmentsByOrder[detailItem.id]?.length}<ul class="voucher-attachments">{#each attachmentsByOrder[detailItem.id] as file}<li><button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}><Paperclip size={13}/><span>{file.file_name}</span><small>{desk.formatFileSize(file.file_size)}</small></button></li>{/each}</ul>{/if}</div>{#if detailItem.reimbursement_status === "已打回"}<div class="voucher-full rejection-detail"><small>打回原因</small><b>{detailItem.reject_reason || "请补充发票资料"}</b></div>{/if}<div class="voucher-full"><small>备注</small><b>{detailItem.note || "—"}</b></div></div></div>
        <div class="drawer-footer"><button class="outline-action" type="button" onclick={() => detailItem = null}>关闭</button></div>
      </div>
    </div>
  {/if}
</section>
