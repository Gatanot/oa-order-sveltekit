<script lang="ts">
  import { getContext } from 'svelte';
  import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-svelte';
  const desk = getContext<any>('order-desk');
  let expanded = $state(false);
  const extraCount = $derived([desk.filterProject, desk.filterDesigner, desk.filterOwner, desk.filterCreator].filter(Boolean).length);
  const chips = $derived([
    { key: 'search', label: '搜索', value: desk.search },
    { key: 'filterCustomer', label: '客户', value: desk.filterCustomer, text: desk.customers.find((item: any) => item.id === desk.filterCustomer)?.name },
    { key: 'filterProject', label: '项目', value: desk.filterProject, text: desk.projects.find((item: any) => item.id === desk.filterProject)?.name },
    { key: 'filterPayment', label: '结款', value: desk.filterPayment },
    { key: 'filterFrom', label: '开始日期', value: desk.filterFrom },
    { key: 'filterTo', label: '结束日期', value: desk.filterTo },
    { key: 'filterDesigner', label: '设计师', value: desk.filterDesigner },
    { key: 'filterOwner', label: '负责人', value: desk.filterOwner },
    { key: 'filterCreator', label: '录入人', value: desk.filterCreator },
  ].filter((item) => item.value));
  function remove(key: string) {
    desk[key] = '';
    if (key === 'filterCustomer') desk.onFilterCustomerChange();
  }
</script>

<fieldset class="order-list-filters" aria-label="订单筛选" disabled={desk.bulkRunning}>
  <div class="order-filter-primary">
    <label class="field filter-search"><span>搜索</span><div class="search-field"><Search size={16} /><input aria-label="搜索订单" bind:value={desk.search} placeholder="订单 / 产品 / 联系人" /></div></label>
    <label class="field"><span>客户</span><select bind:value={desk.filterCustomer} onchange={desk.onFilterCustomerChange}><option value="">全部客户</option>{#each desk.customers as customer}<option value={customer.id}>{customer.name}</option>{/each}</select></label>
    <label class="field"><span>结款状态</span><select bind:value={desk.filterPayment}><option value="">全部</option><option>未结款</option><option>已结款</option></select></label>
    <div class="field order-date-field"><span id="order-date-label">订单日期</span><div class="order-date-range" role="group" aria-labelledby="order-date-label">
      <input class="date-input" aria-label="开始日期" type="date" bind:value={desk.filterFrom} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /><span aria-hidden="true">至</span><input class="date-input" aria-label="结束日期" type="date" bind:value={desk.filterTo} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} />
    </div></div>
    <div class="order-filter-commands"><button type="button" class="outline-action" class:has-filters={extraCount > 0} aria-expanded={expanded} aria-controls="order-extra-filters" onclick={() => expanded = !expanded}><SlidersHorizontal size={15} />更多筛选{#if extraCount}<span class="filter-count">{extraCount}</span>{/if}<ChevronDown size={14} class={expanded ? 'is-expanded' : ''} /></button><button class="outline-action" type="button" disabled={!chips.length && desk.orderSort === 'date_desc'} onclick={desk.resetOrderFilters}>清空筛选</button></div>
  </div>
  {#if expanded}
    <div class="order-filter-extra" id="order-extra-filters">
      <label class="field"><span>项目</span><select bind:value={desk.filterProject}><option value="">全部项目</option>{#each desk.projects.filter((item: any) => !desk.filterCustomer || item.customer_id === desk.filterCustomer) as project}<option value={project.id}>{project.name}</option>{/each}</select></label>
      <label class="field"><span>设计师</span><select bind:value={desk.filterDesigner}><option value="">全部设计师</option>{#each desk.designers as designer}<option value={designer}>{designer}</option>{/each}</select></label>
      <label class="field"><span>负责人</span><select bind:value={desk.filterOwner}><option value="">全部负责人</option>{#each desk.owners as owner}<option value={owner}>{owner}</option>{/each}</select></label>
      <label class="field"><span>录入人</span><select bind:value={desk.filterCreator}><option value="">全部录入人</option>{#each desk.creators as creator}<option value={creator}>{creator}</option>{/each}</select></label>
    </div>
  {/if}
  {#if chips.length}
    <div class="order-filter-chips" aria-label="已生效筛选">
      {#each chips as chip}<button type="button" class="order-filter-chip" aria-label={`移除${chip.label}筛选：${chip.text || chip.value}`} title={`${chip.label}：${chip.text || chip.value}`} onclick={() => remove(chip.key)}><span>{chip.label}：{chip.text || chip.value}</span><X size={13} /></button>{/each}
    </div>
  {/if}
</fieldset>
