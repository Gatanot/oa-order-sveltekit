<script lang="ts">
  import { getContext } from "svelte";
  import { Download, X } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

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
        <div class="column-picker">
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
        </div>
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
