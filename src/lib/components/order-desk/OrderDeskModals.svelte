<script lang="ts">
  import { getContext } from "svelte";
  import { Download, X } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

{#if desk.showStandaloneReimbursement}<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.showStandaloneReimbursement = false; }}>
  <div class="project-modal reimbursement-modal" role="dialog" aria-modal="true" aria-labelledby="reimbursement-modal-title">
    <div class="project-modal-head"><div><p class="section-kicker">NEW REIMBURSEMENT</p><h2 id="reimbursement-modal-title">新建报销</h2><span>可关联已有订单，也可以作为内务报销提交。</span></div><button class="icon-control" aria-label="关闭新建报销窗口" onclick={() => desk.showStandaloneReimbursement = false}><X size={18} /></button></div>
    <form onsubmit={(event) => { event.preventDefault(); desk.submitStandaloneReimbursement(); }}>
      <div class="project-modal-body reimbursement-form-body">
        <label>报销人 <em>*</em><input bind:value={desk.standaloneEmployee} placeholder="例如：张三" readonly={desk.reimbursementRole === "employee"} required /></label>
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
{#if desk.showProjectForm}<div
    class="project-modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) desk.showProjectForm = false;
    }}
  >
    <div
      class="project-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
    >
      <div class="project-modal-head">
        <div>
          <p class="section-kicker">NEW PROJECT</p>
          <h2 id="project-modal-title">新建项目</h2>
          <span>创建成功后将自动选中该项目。</span>
        </div>
        <button
          class="icon-control project-modal-close"
          aria-label="关闭新建项目窗口"
          title="关闭"
          onclick={() => (desk.showProjectForm = false)}><X size={18} /></button
        >
      </div>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          desk.submitProject();
        }}
      >
        <div class="project-modal-body">
          <label
            >客户名称 <em>*</em><input
              bind:value={desk.newCustomer}
              placeholder="例如：华东科技有限公司"
              required
            /></label
          ><label
            >项目名称 <em>*</em><input
              bind:value={desk.newProject}
              placeholder="例如：办公楼改造项目"
              required
            /></label
          ><label
            >项目负责人<input
              bind:value={desk.newOwner}
              placeholder="例如：张三"
            /></label
          >
        </div>
        <div class="project-modal-footer">
          <button
            type="button"
            class="outline-action"
            onclick={() => (desk.showProjectForm = false)}>取消</button
          ><button type="submit" class="primary-action" disabled={desk.busy}
            >{desk.busy ? "保存中..." : "保存项目"}</button
          >
        </div>
      </form>
    </div>
  </div>{/if}
{#if desk.settingsOpen}<div
    class="drawer-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) desk.settingsOpen = false;
    }}
  >
    <div
      class="export-drawer settings-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="creator-settings-title"
    >
      <div class="drawer-head">
        <div>
          <p class="section-kicker">PERSONAL SETTINGS</p>
          <h2 id="creator-settings-title">设置填写人</h2>
          <span>名字会保存在当前浏览器中，不会自动过期。</span>
        </div>
        <button
          class="icon-control"
          aria-label="关闭设置"
          onclick={() => (desk.settingsOpen = false)}><X size={17} /></button
        >
      </div>
      <div class="drawer-body">
        <label class="settings-name-field"
          >常用名字<input
            bind:value={desk.creatorNameDraft}
            maxlength="40"
            placeholder="例如：张三"
            onkeydown={(event) => {
              if (event.key === "Enter") desk.saveCreatorName();
            }}
          /></label
        >
        <p class="settings-hint">
          保存后，新建订单的“录入人”会自动填入该名字。你仍可以在单笔订单中修改录入人。
        </p>
      </div>
      <div class="drawer-footer">
        <button
          class="delete-action"
          disabled={!desk.creatorName}
          onclick={desk.removeCreatorName}>删除已保存名字</button
        ><button class="primary-action" onclick={desk.saveCreatorName}
          >保存名字</button
        >
      </div>
    </div>
  </div>{/if}
{#if desk.showOrderFilters}<div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.showOrderFilters = false; }}>
  <div class="export-drawer filter-drawer" role="dialog" aria-modal="true" aria-labelledby="order-filter-title" tabindex="-1">
    <div class="drawer-head"><div><p class="section-kicker">ORDER FILTERS</p><h2 id="order-filter-title">筛选订单</h2><span>筛选结果会同步更新列表与金额汇总</span></div><button class="icon-control" aria-label="关闭筛选" onclick={() => desk.showOrderFilters = false}><X size={17} /></button></div>
    <div class="drawer-body"><div class="drawer-filter-grid">
      <label>项目负责人<select bind:value={desk.filterOwner}><option value="">全部负责人</option>{#each desk.owners as owner}<option value={owner}>{owner}</option>{/each}</select></label>
      <label>设计师<select bind:value={desk.filterDesigner}><option value="">全部设计师</option>{#each desk.designers as designer}<option value={designer}>{designer}</option>{/each}</select></label>
      <label>结款状态<select bind:value={desk.filterPayment}><option value="">全部结款状态</option><option>未结款</option><option>已结款</option></select></label>
      <label>录入人<select bind:value={desk.filterCreator}><option value="">全部录入人</option>{#each desk.creators as creator}<option value={creator}>{creator}</option>{/each}</select></label>
      <label>开始日期<input class="date-input" type="date" bind:value={desk.filterFrom} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
      <label>结束日期<input class="date-input" type="date" bind:value={desk.filterTo} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
    </div></div>
    <div class="drawer-footer"><button class="outline-action" type="button" onclick={desk.resetOrderFilters}>重置全部</button><button class="primary-action" type="button" onclick={() => desk.showOrderFilters = false}>查看结果</button></div>
  </div>
</div>{/if}
{#if desk.showExport}<div
    class="drawer-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) desk.showExport = false;
    }}
  >
    <section class="export-drawer" role="dialog" aria-modal="true">
      <div class="drawer-head">
        <div>
          <p class="section-kicker">EXPORT</p>
          <h2>导出订单</h2>
          <span>当前筛选条件会一并应用到导出结果</span>
        </div>
        <button class="icon-control" onclick={() => (desk.showExport = false)}
          ><X size={17} /></button
        >
      </div>
      <div class="drawer-body">
        <div class="export-mode-picker">
          <label>导出模式<select bind:value={desk.exportMode}><option value="detail">自选字段明细</option><option value="settlement">客户结算单</option></select></label>
          {#if desk.exportMode === "settlement"}
            <div class="export-template-grid">
              <label>标题<input bind:value={desk.exportTitle} placeholder="例如：2026年宣传物料结算单" /></label>
              <label>合同编号<input bind:value={desk.exportContract} placeholder="可留空" /></label>
              <label>甲方（客户）<input bind:value={desk.exportPartyA} placeholder="客户名称" /></label>
              <label>乙方（我方）<input bind:value={desk.exportPartyB} placeholder="执行方名称，可留空" /></label>
              <label>乙方项目跟进人<input bind:value={desk.exportFollowB} placeholder="可留空" /></label>
            </div>
            <div class="export-options"><label><input type="checkbox" bind:checked={desk.exportRemarkOrder} /> 备注列填写订单编号</label><label><input type="checkbox" bind:checked={desk.exportTotal} /> 附带总计行</label><label><input type="checkbox" bind:checked={desk.exportSign} /> 附带签署栏</label></div>
          {/if}
        </div>
        <div class="export-selection">
          <div class="picker-head">
            <b>选择导出订单</b><span
              >已选 {desk.selectedOrderIds.length} 条</span
            >
          </div>
          <label
            ><input
              type="checkbox"
              checked={desk.allFilteredSelected}
              onchange={desk.toggleFilteredOrders}
            /> 全选当前筛选结果</label
          >
          <div class="selection-list">
            {#each desk.filteredOrders as order}<label
                ><input
                  type="checkbox"
                  checked={desk.selectedOrderIds.includes(order.id)}
                  onchange={() => desk.toggleOrder(order.id)}
                /><span
                  >{order.service_name} · {order.project_name}
                  <small>{order.code}</small></span
                ></label
              >{:else}<span class="muted">当前筛选无订单</span>{/each}
          </div>
        </div>
        <div class="drawer-filter-grid">
          <label
            >开始日期<input class="date-input" type="date" bind:value={desk.filterFrom} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label
          ><label
            >结束日期<input class="date-input" type="date" bind:value={desk.filterTo} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label
          ><label
            >客户<select bind:value={desk.filterCustomer}
              ><option value="">全部客户</option
              >{#each desk.customers as customer}<option value={customer.id}
                  >{customer.name}</option
                >{/each}</select
            ></label
          ><label
            >项目<select bind:value={desk.filterProject}
              ><option value="">全部项目</option
              >{#each desk.projects.filter((item: any) => !desk.filterCustomer || item.customer_id === desk.filterCustomer) as project}<option
                  value={project.id}>{project.name}</option
                >{/each}</select
            ></label
          ><label
            >项目负责人<select bind:value={desk.filterOwner}
              ><option value="">全部负责人</option
              >{#each desk.owners as owner}<option value={owner}>{owner}</option
                >{/each}</select
            ></label
          ><label
            >录入人<select bind:value={desk.filterCreator}
              ><option value="">全部录入人</option
              >{#each desk.creators as creator}<option value={creator}
                  >{creator}</option
                >{/each}</select
            ></label
          >
        </div>
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
      <div class="drawer-footer">
        <span>预计导出 {desk.selectedOrderIds.length} 条记录</span><button
          class="primary-action"
          disabled={!desk.selectedColumns.length ||
            !desk.selectedOrderIds.length}
          onclick={desk.downloadExport}><Download size={16} />下载 Excel</button
        >
      </div>
    </section>
  </div>{/if}
