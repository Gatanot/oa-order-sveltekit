<script lang="ts">
  import { getContext } from "svelte";
  import { Copy, Download, FileText, X } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
  const exportOrders = $derived((desk.orders as any[]).filter((order) => desk.selectedOrderIds.includes(order.id)));
  function exportModeKey(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    desk.exportMode = event.key === 'Home' ? 'detail' : event.key === 'End' ? 'settlement' : desk.exportMode === 'detail' ? 'settlement' : 'detail';
    (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-mode="${desk.exportMode}"]`)?.focus();
  }
  let rejectReasonInput = $state<HTMLTextAreaElement>();
  $effect(() => {
    if (desk.reimbursementRejectOpen) setTimeout(() => rejectReasonInput?.focus());
  });
</script>

{#if desk.showStandaloneReimbursement}<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.showStandaloneReimbursement = false; }}>
  <div class="project-modal reimbursement-modal" role="dialog" aria-modal="true" aria-labelledby="reimbursement-modal-title">
    <div class="project-modal-head"><div><p class="section-kicker">新增报销</p><h2 id="reimbursement-modal-title">新建报销</h2><span>报销人固定为当前登录用户，可关联订单或作为内务报销提交。</span></div><button class="icon-control" aria-label="关闭新建报销窗口" onclick={() => desk.showStandaloneReimbursement = false}><X size={18} /></button></div>
    <form onsubmit={(event) => { event.preventDefault(); desk.submitStandaloneReimbursement(); }}>
      <div class="project-modal-body reimbursement-form-body">
        <label>报销人 <em>*</em><input bind:value={desk.standaloneEmployee} readonly required /></label>
        <label>报销物品 <em>*</em><input bind:value={desk.standaloneItem} placeholder="例如：客户现场打车" required /></label>
        <label>报销金额（元） <em>*</em><input type="number" inputmode="decimal" min="0.01" step="0.01" bind:value={desk.standaloneAmount} placeholder="0.00" required /></label>
        <label>垫付日期 <em>*</em><input class="date-input" type="date" bind:value={desk.standaloneDate} required /></label>
        <label class="full-field">关联订单<select bind:value={desk.standaloneOrderId}><option value="">不关联订单 · 内务报销</option>{#each desk.orders as order}<option value={order.id}>{order.code} · {order.customer_name} · {order.project_name}</option>{/each}</select></label>
        <label class="full-field">发票文件<input type="text" value={desk.standaloneInvoice || "未上传附件"} readonly onclick={() => document.getElementById("standalone-invoice")?.click()} /><input id="standalone-invoice" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" onchange={desk.onStandaloneInvoiceChange} /></label>
        <label class="full-field">备注<textarea bind:value={desk.standaloneNote} placeholder="补充报销说明（选填）"></textarea></label>
      </div>
      <div class="project-modal-footer"><button type="button" class="outline-action" onclick={() => desk.showStandaloneReimbursement = false}>取消</button><button type="submit" class="primary-action" disabled={desk.busy}>{desk.busy ? "保存中..." : "保存报销"}</button></div>
    </form>
  </div>
</div>{/if}
{#if desk.showCompleteOrder}<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.showCompleteOrder = false; }}>
  <div class="project-modal" role="dialog" aria-modal="true" aria-labelledby="complete-order-modal-title">
    <div class="project-modal-head"><div><p class="section-kicker">完成订单</p><h2 id="complete-order-modal-title">标记为已完成</h2><span>确认后订单状态将变为“已完成”，并记录本次操作人。</span></div><button class="icon-control" aria-label="关闭完成订单窗口" onclick={() => desk.showCompleteOrder = false}><X size={18} /></button></div>
    <form onsubmit={(event) => { event.preventDefault(); desk.submitCompleteOrder(); }}>
      <div class="project-modal-body">
        <p class="confirm-message">确认将订单 <b>{desk.completeOrderTarget?.code}</b>（{desk.completeOrderTarget?.service_name}）标记为已完成？</p>
        {#if desk.completeOrderNeedsDesign}
          <label class="full-field">设计图 <em>*</em><input type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" onchange={desk.onCompleteOrderFilesChange} /></label>
          <p class="field-hint">设计师完成订单必须上传设计图（图片或 PDF，单个不超过 10MB）。</p>
          {#if desk.completeOrderFiles.length}
            <ul class="upload-list">{#each desk.completeOrderFiles as file, i}<li><span class="upload-name"><FileText size={13}/>{file.name}</span><small>{desk.formatFileSize(file.size)}</small><button type="button" class="upload-remove" aria-label={`移除 ${file.name}`} onclick={() => desk.removeCompleteOrderFile(i)}><X size={13}/></button></li>{/each}</ul>
          {/if}
        {/if}
      </div>
      <div class="project-modal-footer"><button type="button" class="outline-action" onclick={() => desk.showCompleteOrder = false}>取消</button><button type="submit" class="primary-action" disabled={desk.busy}>{desk.busy ? "提交中..." : "确认完成"}</button></div>
    </form>
  </div>
</div>{/if}
{#if desk.showExport}<div
    class="drawer-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) desk.showExport = false;
    }}
  >
    <div class="export-drawer" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
      <div class="drawer-head">
        <div>
          <p class="section-kicker">导出数据</p>
          <h2 id="export-dialog-title">导出订单</h2>
          <span>已选 {exportOrders.length} 笔订单</span>
        </div>
        <button class="icon-control" aria-label="关闭导出订单" title="关闭" onclick={() => (desk.showExport = false)}
          ><X size={17} /></button
        >
      </div>
      <div class="drawer-body">
        <div class="export-selection">
          <ul class="export-order-list" aria-label="选中订单">
            {#each exportOrders as order}<li><b>{order.service_name}</b><small>{order.code} · {order.customer_name}</small></li>{:else}<li class="empty-table">没有可导出的订单</li>{/each}
          </ul>
        </div>
        <div class="export-format">
          <div class="export-format-head"><b>导出模式</b>
            <div class="export-mode-tabs" role="tablist" tabindex="-1" aria-label="导出模式" onkeydown={exportModeKey}>
              <button id="export-detail-tab" data-mode="detail" type="button" role="tab" aria-selected={desk.exportMode === 'detail'} aria-controls="export-format-panel" tabindex={desk.exportMode === 'detail' ? 0 : -1} onclick={() => desk.exportMode = 'detail'}>自选字段明细</button>
              <button id="export-settlement-tab" data-mode="settlement" type="button" role="tab" aria-selected={desk.exportMode === 'settlement'} aria-controls="export-format-panel" tabindex={desk.exportMode === 'settlement' ? 0 : -1} onclick={() => desk.exportMode = 'settlement'}>客户结算单</button>
            </div>
          </div>
        </div>
        <div id="export-format-panel" role="tabpanel" aria-labelledby={desk.exportMode === 'detail' ? 'export-detail-tab' : 'export-settlement-tab'}>
          {#if desk.exportMode === "settlement"}
            <label class="export-contract-field">合同编号<input bind:value={desk.exportContract} placeholder="选填" /></label>
            <div class="export-options"><label><input type="checkbox" bind:checked={desk.exportRemarkOrder} /> 备注含订单编号</label><label><input type="checkbox" bind:checked={desk.exportTotal} /> 金额合计</label><label><input type="checkbox" bind:checked={desk.exportSign} /> 签署栏</label></div>
          {:else}
            <div class="export-options"><label><input type="checkbox" bind:checked={desk.exportExpand} /> 按产品展开</label><label><input type="checkbox" bind:checked={desk.exportTotal} /> 金额合计</label></div>
          {/if}
        {#if desk.exportMode === "detail"}<div class="column-picker">
          <div class="picker-head">
            <b>导出列</b><span>已选 {desk.selectedColumns.length} 列</span>
          </div>
          <div class="column-list">
            {#each desk.exportColumns as [key, label]}<label
                ><input
                  type="checkbox"
                  checked={desk.selectedColumns.includes(key)}
                  onchange={() => desk.toggleColumn(key)}
                /><span>{label}</span></label
              >{/each}
          </div>
        </div>{/if}
        </div>
      </div>
      <div class="drawer-footer">
        <span>预计导出 {desk.selectedOrderIds.length} 条订单</span><button
          class="outline-action"
          disabled={(desk.exportMode === "detail" && !desk.selectedColumns.length) || !desk.selectedOrderIds.length}
          onclick={desk.copyExportTable}><Copy size={16} />复制表格</button><button
          class="primary-action"
          disabled={(desk.exportMode === "detail" && !desk.selectedColumns.length) ||
            !desk.selectedOrderIds.length}
          onclick={desk.downloadExport}><Download size={16} />下载 Excel</button
        >
      </div>
    </div>
  </div>{/if}

{#if desk.reimbursementRejectOpen}<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.reimbursementRejectOpen = false; }}>
  <div class="project-modal" role="dialog" aria-modal="true" aria-labelledby="reject-modal-title">
    <div class="project-modal-head"><div><p class="section-kicker">审核结果</p><h2 id="reject-modal-title">打回报销</h2><span>原因会显示给填写人，补传发票后重新进入待审核。</span></div><button class="icon-control" aria-label="关闭打回窗口" onclick={() => desk.reimbursementRejectOpen = false}><X size={18} /></button></div>
    <form onsubmit={(event) => { event.preventDefault(); desk.confirmRejectReimbursements(); }}>
      <div class="project-modal-body"><label class="full-field">打回原因 <em>*</em><textarea bind:this={rejectReasonInput} bind:value={desk.reimbursementRejectReason} placeholder="请说明需要补充或修正的资料" required></textarea></label></div>
      <div class="project-modal-footer"><span>将处理 {desk.reimbursementRejectCount} 条记录</span><button type="button" class="outline-action" onclick={() => desk.reimbursementRejectOpen = false}>取消</button><button type="submit" class="delete-action" disabled={desk.busy}>{desk.busy ? '处理中...' : '确认打回'}</button></div>
    </form>
  </div>
</div>{/if}

{#if desk.confirmOpen}<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.confirmOpen = false; }}>
  <div class="project-modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-modal-title" aria-describedby="confirm-modal-message">
    <div class="project-modal-head"><div><p class="section-kicker">确认操作</p><h2 id="confirm-modal-title">{desk.confirmTitle}</h2></div><button class="icon-control" aria-label="关闭确认窗口" onclick={() => desk.confirmOpen = false}><X size={18} /></button></div>
    <div class="project-modal-body"><p id="confirm-modal-message" class="confirm-message">{desk.confirmMessage}</p></div>
    <div class="project-modal-footer"><button type="button" class="outline-action" onclick={() => desk.confirmOpen = false}>取消</button><button type="button" class={/删除|打回|替换/.test(desk.confirmTitle) ? 'delete-action' : 'primary-action'} disabled={desk.busy} onclick={desk.runConfirm}>确认</button></div>
  </div>
</div>{/if}
