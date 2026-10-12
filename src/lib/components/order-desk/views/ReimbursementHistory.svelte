<script lang="ts">
  import { getContext } from "svelte";
  import { appPath } from "$lib/api";
  import { ChevronLeft, ChevronRight, Download, Paperclip, X } from "lucide-svelte";
  import WorkbenchListFilters from '../WorkbenchListFilters.svelte';
  const desk = getContext<any>("order-desk");
  const canExport = $derived(["finance", "admin"].includes(desk.identity?.role));
  let detailItem = $state<any>(null);
  let attachmentsByOrder = $state<Record<string, Array<any>>>({});
  let peopleExpanded = $state(false);
  const filterFields = $derived([
    { key: 'historySearch', label: '搜索', type: 'search' as const, value: desk.historySearch, placeholder: '单据 / 订单 / 物品 / 报销人' },
    { key: 'historyProject', label: '项目', value: desk.historyProject, options: [{ value: '', label: '全部项目' }, ...desk.projects.map((item: any) => ({ value: item.id, label: item.name }))] },
    { key: 'historyPerson', label: '报销人', value: desk.historyPerson, options: [{ value: '', label: '全部报销人' }, ...desk.historyPeople.map((value: string) => ({ value, label: value }))] },
    { key: 'historyFrom', label: '垫付日期', type: 'date-range' as const, value: desk.historyFrom, endKey: 'historyTo', endValue: desk.historyTo },
  ]);
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

<section class="page-section workbench-list-page history-page">
  <div class="section-heading">
    <div>
      <p class="section-kicker">报销归档</p>
      <h2>历史报销</h2>
    </div>
  </div>

  <WorkbenchListFilters fields={filterFields} onchange={(key, value) => desk[key] = value} onclear={desk.resetHistoryFilters} label="历史报销筛选" />
  <div class="workbench-statistics"><div class="workbench-statistics-head"><span>当前筛选结果 · {desk.historyRows.length} 笔报销</span></div>
  <div class="summary-row reimbursement-summary">
    <div><span>已完成单数</span><b>{desk.historyStats.count}<small> 单</small></b></div>
    <div><span>已完成金额</span><b>{desk.money(desk.historyStats.amount)}</b></div>
    <div><span>已归档单据</span><b>{desk.historyStats.archived}<small> 单</small></b></div>
    <div><span>涉及报销人</span><b>{desk.historyStats.people}<small> 人</small></b></div>
  </div>
  </div>

  <div class="table-tools workbench-table-tools"><div class="order-table-heading"><h3>报销单据</h3><span class="filter-result">共 {desk.historyRows.length} 笔，第 {desk.historyPage} / {desk.historyPageCount} 页</span></div><div class="table-actions"><button class="outline-action" type="button" aria-expanded={peopleExpanded} aria-controls="history-person-summary" disabled={!desk.historyByPerson.length} onclick={() => peopleExpanded = !peopleExpanded}>按报销人统计</button>{#if canExport}<button class="outline-action" type="button" onclick={desk.exportHistory}><Download size={15} />导出当前筛选</button>{/if}</div></div>
  {#if peopleExpanded && desk.historyByPerson.length}
    <div id="history-person-summary" class="history-person-summary"><h3>按报销人统计</h3>
    <div class="table-panel">
      <div class="table-scroll">
        <table>
          <thead><tr><th>报销人</th><th>完成单数</th><th>完成金额</th><th>金额占比</th></tr></thead>
          <tbody>
            {#each desk.historyByPerson as group}
              <tr>
                <td><b>{group.employee}</b></td>
                <td>{group.count}</td>
                <td class="money">{desk.money(group.amount)}</td>
                <td>{desk.historyStats.amount ? (group.amount / desk.historyStats.amount * 100).toFixed(1) : "0.0"}%</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  {/if}

  <div class="table-panel reimbursement-review-table">
    <div class="table-scroll">
      <table>
        <thead><tr><th>单据编号</th><th>来源订单</th><th>报销人</th><th>报销物品</th><th>垫付日期</th><th>金额</th><th>归档时间</th><th>操作</th></tr></thead>
        <tbody>
          {#each desk.pagedHistoryRows as item}
            <tr>
              <td><b>{item.voucher_no || "—"}</b></td>
              <td>{#if item.order_id}<button class="link-action" type="button" onclick={() => desk.openDetail(desk.orders.find((order: any) => order.id === item.order_id))}><b>{item.code}</b></button>{:else}<b class="muted">内务报销</b>{/if}</td>
              <td>{item.employee}</td>
              <td>{item.advance_item || "—"}</td>
              <td>{item.advance_date}</td>
              <td class="money">{desk.money(item.advance_amount)}</td>
              <td>{item.voucher_archived_at ? item.voucher_archived_at.slice(0, 10) : "未归档"}</td>
              <td><button class="link-action" type="button" onclick={() => detailItem = item}>查看单据</button></td>
            </tr>
          {:else}
            <tr><td colspan="8"><div class="empty-table">当前筛选没有已完成的历史报销。{#if filterFields.some((field) => field.value || field.endValue)}<button class="outline-action" type="button" onclick={desk.resetHistoryFilters}>清空筛选</button>{/if}</div></td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {#if desk.historyPageCount > 1}
    <nav class="order-pagination" aria-label="历史报销分页">
      <button class="icon-control" title="上一页" aria-label="上一页" disabled={desk.historyPage === 1} onclick={() => desk.setHistoryPage(desk.historyPage - 1)}><ChevronLeft size={17} /></button>
      <div class="order-page-numbers">
        {#each Array(desk.historyPageCount) as _, i}
          {@const page = i + 1}
          {#if page === 1 || page === desk.historyPageCount || Math.abs(page - desk.historyPage) <= 1}
            <button class:active={page === desk.historyPage} class="order-page-number" aria-label={`第 ${page} 页`} aria-current={page === desk.historyPage ? "page" : undefined} onclick={() => desk.setHistoryPage(page)}>{page}</button>
          {:else if page === 2 || page === desk.historyPageCount - 1}
            <span class="order-page-ellipsis">…</span>
          {/if}
        {/each}
      </div>
      <button class="icon-control" title="下一页" aria-label="下一页" disabled={desk.historyPage === desk.historyPageCount} onclick={() => desk.setHistoryPage(desk.historyPage + 1)}><ChevronRight size={17} /></button>
    </nav>
  {/if}

  {#if detailItem}
    <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailItem = null; }}>
      <div class="export-drawer reimbursement-detail" role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
        <div class="drawer-head"><div><p class="section-kicker">报销单据</p><h2 id="history-detail-title">{detailItem.voucher_no || "报销单据"}</h2><span>{detailItem.source_type || "订单报销"} · {detailItem.reimbursement_status}</span></div><button class="icon-control" aria-label="关闭报销单据" onclick={() => detailItem = null}><X size={18} /></button></div>
        <div class="drawer-body">
          <ol class="reimbursement-progress" aria-label="报销进度">{#each ["提交报销", "管理人审核", "财务复核", "老板确认", "财务执行"] as step, index}<li class="completed"><span>{index + 1}</span>{step}</li>{/each}</ol>
          <div class="voucher-grid">
            <div><small>单据编号</small><b>{detailItem.voucher_no || "—"}</b></div>
            <div><small>报销人</small><b>{detailItem.employee}</b></div>
            <div><small>报销物品</small><b>{detailItem.advance_item || detailItem.item}</b></div>
            <div><small>报销金额</small><b>{desk.money(detailItem.advance_amount)}</b></div>
            <div><small>垫付日期</small><b>{detailItem.advance_date}</b></div>
            <div><small>归档时间</small><b>{detailItem.voucher_archived_at ? detailItem.voucher_archived_at.slice(0, 19).replace("T", " ") : "未归档"}</b></div>
            <div><small>关联订单</small><b>{detailItem.code || "内务报销"}</b></div>
            <div><small>客户 / 项目</small><b>{detailItem.customer_name ? `${detailItem.customer_name} · ` : ""}{detailItem.project_name || "内务报销"}</b></div>
            <div class="voucher-full"><small>发票附件</small>{#if detailItem.attachment_count}<button class="link-action voucher-attachment-button" type="button" onclick={() => showAttachments(detailItem)}>{detailItem.invoice || "查看附件"} · {detailItem.attachment_count} 个</button>{:else}<b>{detailItem.invoice || "未上传"}</b>{/if}{#if attachmentsByOrder[detailItem.id]?.length}<ul class="voucher-attachments">{#each attachmentsByOrder[detailItem.id] as file}<li><button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}><Paperclip size={13}/><span>{file.file_name}</span><small>{desk.formatFileSize(file.file_size)}</small></button></li>{/each}</ul>{/if}</div>
            <div class="voucher-full"><small>备注</small><b>{detailItem.note || "—"}</b></div>
          </div>
        </div>
      </div>
    </div>
  {/if}
</section>
