<script lang="ts">
  import { getContext } from 'svelte';
  import { Building2, ChevronLeft, ChevronRight, Factory, FileSpreadsheet, Plus, Search, Upload, Users, X } from 'lucide-svelte';
  import WorkbenchListFilters from '../WorkbenchListFilters.svelte';
  import CustomerManager from '../CustomerManager.svelte';
  const desk = getContext<any>('order-desk');

  type CatalogSource = {
    id: string;
    kind: 'quote' | 'cost';
    owner_name: string;
    library_name?: string;
    source_file?: string;
    item_count?: number;
    updated_at?: string;
    active?: number;
  };
  type QuoteCustomer = { name: string; sources: CatalogSource[]; itemCount: number; updatedAt: string };

  let detailSource = $state<any>(null);
  let detailSearch = $state('');
  let reuploadInput = $state<HTMLInputElement | null>(null);
  let customerTabOpen = $state(false);
  let quoteCustomerSearch = $state('');
  let selectedQuoteCustomer = $state('');
  const catalogTabs = ['quote', 'cost', 'customers'] as const;
  const activeCatalogTab = $derived(customerTabOpen ? 'customers' : desk.catalogKind);

  function selectCatalogTab(tab: typeof catalogTabs[number]) {
    if (tab === 'customers') { customerTabOpen = true; selectedQuoteCustomer = ''; return; }
    customerTabOpen = false;
    if (tab !== 'quote') selectedQuoteCustomer = '';
    desk.catalogKind = tab;
  }
  function onCatalogTabKeydown(event: KeyboardEvent, index: number) {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? catalogTabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + catalogTabs.length) % catalogTabs.length;
    selectCatalogTab(catalogTabs[next]);
    const buttons = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }

  const sources = () => desk.catalogSources.filter((source: CatalogSource) => source.kind === desk.catalogKind);
  const quoteSources = $derived((desk.catalogSources as CatalogSource[]).filter((source) => source.kind === 'quote' && source.active !== 0));
  const quoteCustomers = $derived.by(() => {
    const groups = new Map<string, QuoteCustomer>();
    for (const source of quoteSources) {
      const name = String(source.owner_name || '').trim() || '未命名客户';
      const group = groups.get(name) || { name, sources: [], itemCount: 0, updatedAt: '' };
      group.sources.push(source);
      group.itemCount += Number(source.item_count || 0);
      const updatedAt = String(source.updated_at || '');
      if (updatedAt > group.updatedAt) group.updatedAt = updatedAt;
      groups.set(name, group);
    }
    for (const group of groups.values()) {
      group.sources.sort((left, right) => sourceLabel(left).localeCompare(sourceLabel(right), 'zh-CN'));
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  });
  const visibleQuoteCustomers = $derived.by(() => {
    const keyword = quoteCustomerSearch.trim().toLowerCase();
    if (!keyword) return quoteCustomers;
    return quoteCustomers.filter((customer) =>
      customer.name.toLowerCase().includes(keyword) ||
      customer.sources.some((source) => `${sourceLabel(source)} ${source.source_file || ''}`.toLowerCase().includes(keyword))
    );
  });
  const selectedQuoteCustomerGroup = $derived(quoteCustomers.find((customer) => customer.name === selectedQuoteCustomer) || null);
  const quoteSummary = $derived({
    customers: visibleQuoteCustomers.length,
    libraries: visibleQuoteCustomers.reduce((total, customer) => total + customer.sources.length, 0),
    items: visibleQuoteCustomers.reduce((total, customer) => total + customer.itemCount, 0)
  });

  function sourceLabel(source: CatalogSource) {
    const libraryName = String(source?.library_name || '').trim().split(/[\\/]/).pop() || '';
    if (libraryName) return libraryName.replace(/\.(xlsx?|csv)$/i, '');
    const fileName = String(source?.source_file || '').trim().split(/[\\/]/).pop() || '';
    return fileName ? fileName.replace(/\.[^.]+$/, '') : source.kind === 'cost' ? '未命名成本库' : '未命名报价库';
  }
  function formatDate(value: unknown) {
    return value ? String(value).slice(0, 10) : '—';
  }
  function openQuoteCustomer(name: string) {
    selectedQuoteCustomer = name;
  }
  function openQuoteSource(source: CatalogSource) {
    detailSearch = '';
    detailSource = source;
  }
  function onQuoteRowKeydown(event: KeyboardEvent, name: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openQuoteCustomer(name);
  }

  const filterFields = $derived([
    { key: 'catalogSearch', label: '搜索', type: 'search' as const, value: desk.catalogSearch, placeholder: '名称 / 分类 / 公司 / 项目' },
    { key: 'catalogCategory', label: '分类', value: desk.catalogCategory, options: [{ value: '', label: '全部分类' }, ...desk.catalogCategories.map((value: string) => ({ value, label: value }))] },
    { key: 'catalogSourceId', label: '厂商', value: desk.catalogSourceId, options: [{ value: '', label: '全部厂商' }, ...sources().map((item: CatalogSource) => ({ value: item.id, label: item.library_name && item.library_name !== item.owner_name ? `${item.owner_name} · ${item.library_name}` : item.owner_name }))] },
  ]);
  function clearFilters() { desk.catalogSearch = ''; desk.catalogCategory = ''; desk.catalogSourceId = ''; }
  const detailItems = () => {
    const keyword = detailSearch.trim().toLowerCase();
    const list = detailSource?.kind === 'cost' ? desk.catalogCost : desk.catalogQuote;
    return list.filter((item: any) => item.source_id === detailSource?.id && (!keyword || `${item.name} ${item.category} ${item.specification || ''} ${item.supplier_name || item.remark || ''}`.toLowerCase().includes(keyword)));
  };
  const previewColumns = () => Object.keys(desk.catalogImportPreview?.rows?.[0] || {}).filter((key) => !['source_file', 'source_sheet'].includes(key)).slice(0, 6);
  function closeTopLayer() {
    if (desk.catalogImportPreview) desk.cancelCatalogImport();
    else if (desk.catalogSourceOpen) desk.catalogSourceOpen = false;
    else if (detailSource) detailSource = null;
    else if (selectedQuoteCustomer) selectedQuoteCustomer = '';
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') closeTopLayer(); }} />
<input type="file" accept=".xlsx,.xls,.csv" class="visually-hidden" bind:this={reuploadInput} onchange={desk.onCatalogReuploadChange} />

<section class="page-section workbench-list-page catalog-page">
  <div class="section-heading">
    <div><p class="section-kicker">基础资料</p><h2>报价库与成本库</h2></div>
    {#if customerTabOpen}
      {#if !desk.canManageCatalog}<span class="readonly-badge">只读</span>{/if}
    {:else}
      <div class="top-actions">
        {#if desk.catalogKind === 'quote' && selectedQuoteCustomerGroup}
          <button class="outline-action" type="button" onclick={() => selectedQuoteCustomer = ''}><ChevronLeft size={15} />全部客户</button>
        {/if}
        {#if desk.canManageCatalog}
          <button class="primary-action" type="button" onclick={() => desk.openCatalogSourceForm(desk.catalogKind === 'quote' ? selectedQuoteCustomerGroup?.name || '' : '')}><Plus size={16} />新增{desk.catalogKind === 'quote' ? '报价库' : '成本库'}</button>
        {:else if !(desk.catalogKind === 'quote' && selectedQuoteCustomerGroup)}
          <span class="readonly-badge">只读</span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="catalog-tabs" role="tablist" aria-label="报价库、成本库与客户管理">
    <button role="tab" aria-selected={activeCatalogTab === 'quote'} tabindex={activeCatalogTab === 'quote' ? 0 : -1} class:active={activeCatalogTab === 'quote'} onclick={() => selectCatalogTab('quote')} onkeydown={(event) => onCatalogTabKeydown(event, 0)}><Building2 size={16} />客户报价库</button>
    <button role="tab" aria-selected={activeCatalogTab === 'cost'} tabindex={activeCatalogTab === 'cost' ? 0 : -1} class:active={activeCatalogTab === 'cost'} onclick={() => selectCatalogTab('cost')} onkeydown={(event) => onCatalogTabKeydown(event, 1)}><Factory size={16} />厂商成本库</button>
    <button role="tab" aria-selected={activeCatalogTab === 'customers'} tabindex={activeCatalogTab === 'customers' ? 0 : -1} class:active={activeCatalogTab === 'customers'} onclick={() => selectCatalogTab('customers')} onkeydown={(event) => onCatalogTabKeydown(event, 2)}><Users size={16} />客户管理</button>
  </div>

  {#if customerTabOpen}
    <CustomerManager />
  {:else if desk.catalogKind === 'quote'}
    {#if selectedQuoteCustomerGroup}
      <div class="table-tools workbench-table-tools">
        <div class="order-table-heading"><h3>{selectedQuoteCustomerGroup.name} · 报价库</h3><span class="filter-result">共 {selectedQuoteCustomerGroup.sources.length} 个报价库，{selectedQuoteCustomerGroup.itemCount} 条报价</span></div>
      </div>
      <div class="table-panel">
        <div class="table-scroll">
          <table>
            <thead><tr><th>报价库</th><th>来源文件</th><th>报价条目</th><th>最近更新</th><th>操作</th></tr></thead>
            <tbody>
              {#each selectedQuoteCustomerGroup.sources as source (source.id)}
                <tr>
                  <td><b>{sourceLabel(source)}</b></td>
                  <td>{source.source_file || '手工维护'}</td>
                  <td>{source.item_count || 0} 条</td>
                  <td>{formatDate(source.updated_at)}</td>
                  <td>
                    <div class="catalog-source-actions">
                      <button class="link-action" type="button" onclick={() => openQuoteSource(source)}>查看明细</button>
                      {#if desk.canManageCatalog}<button class="link-action" type="button" onclick={() => { if (desk.beginCatalogReupload(source.id)) reuploadInput?.click(); }}>重新上传</button>{/if}
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {:else}
      <div class="catalog-filters">
        <label class="search-field"><Search size={16} /><input bind:value={quoteCustomerSearch} placeholder="搜索客户或报价库" /></label>
      </div>
      <div class="workbench-statistics">
        <div class="workbench-statistics-head"><span>当前筛选结果 · {quoteSummary.customers} 个客户</span></div>
        <div class="summary-row">
          <div><span>客户</span><b>{quoteSummary.customers}</b></div>
          <div><span>报价库</span><b>{quoteSummary.libraries}</b></div>
          <div><span>报价条目</span><b>{quoteSummary.items}</b></div>
        </div>
      </div>
      <div class="table-tools workbench-table-tools"><div class="order-table-heading"><h3>客户报价库</h3><span class="filter-result">共 {visibleQuoteCustomers.length} 个客户</span></div></div>
      <div class="table-panel">
        <div class="table-scroll">
          <table>
            <thead><tr><th>客户</th><th>报价库</th><th>报价条目</th><th>最近更新</th><th>操作</th></tr></thead>
            <tbody>
              {#each visibleQuoteCustomers as customer (customer.name)}
                <tr class="order-click-row" tabindex="0" role="button" aria-label={`查看客户 ${customer.name} 的报价库`} onclick={() => openQuoteCustomer(customer.name)} onkeydown={(event) => onQuoteRowKeydown(event, customer.name)}>
                  <td><b>{customer.name}</b></td>
                  <td>{customer.sources.length} 个</td>
                  <td>{customer.itemCount} 条</td>
                  <td>{formatDate(customer.updatedAt)}</td>
                  <td><button class="link-action" type="button" onclick={(event) => { event.stopPropagation(); openQuoteCustomer(customer.name); }}>查看报价库</button></td>
                </tr>
              {:else}
                <tr><td colspan="5"><div class="empty-table">{quoteCustomerSearch ? '没有匹配的客户或报价库。' : '暂无客户报价库。'}{#if quoteCustomerSearch}<button class="outline-action" type="button" onclick={() => quoteCustomerSearch = ''}>清空搜索</button>{/if}</div></td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <WorkbenchListFilters fields={filterFields} onchange={(key, value) => desk[key] = value} onclear={clearFilters} label="成本库筛选" />
    <div class="workbench-statistics"><div class="workbench-statistics-head"><span>当前筛选结果 · {desk.visibleCatalog.length} 条资料</span></div><div class="summary-row"><div><span>资料条目</span><b>{desk.visibleCatalog.length}</b></div><div><span>厂商来源</span><b>{new Set(desk.visibleCatalog.map((item: any) => item.source_id || item.customer_name || '通用')).size}</b></div><div><span>涉及分类</span><b>{new Set(desk.visibleCatalog.map((item: any) => item.category || '未分类')).size}</b></div></div></div>
    <div class="table-tools workbench-table-tools"><div class="order-table-heading"><h3>厂商成本明细</h3><span class="filter-result">共 {desk.visibleCatalog.length} 条，第 {desk.catalogPage} / {desk.catalogPageCount} 页</span></div></div>
    <details class="catalog-sources-disclosure"><summary>来源配置<span>{sources().length} 个厂商</span><ChevronRight size={15} /></summary>
      <div class="catalog-source-grid">
        {#each sources() as source}
          <div class:active={desk.catalogSourceId === source.id} class="catalog-source-card">
            <button class="catalog-source-select" onclick={() => desk.catalogSourceId = desk.catalogSourceId === source.id ? '' : source.id}><span>厂商</span><b>{source.owner_name}</b><small>{source.item_count} 个项目 · {sourceLabel(source)}</small></button>
            <div class="catalog-source-actions">
              <button class="catalog-source-detail" onclick={() => { detailSearch = ''; detailSource = source; }}>查看明细</button>
              {#if desk.canManageCatalog}<button class="catalog-source-detail" onclick={() => { if (desk.beginCatalogReupload(source.id)) reuploadInput?.click(); }}>重新上传配置</button>{/if}
            </div>
          </div>
        {:else}<div class="catalog-empty-source"><FileSpreadsheet size={20} /><span>暂无厂商成本来源</span></div>{/each}
      </div>
    </details>
    <div class="table-panel catalog-table-panel"><div class="table-scroll"><table>
      <thead><tr><th>分类</th><th>项目名称</th><th>厂商</th><th>制作要求 / 备注</th><th>单位</th><th>成本单价</th></tr></thead>
      <tbody>{#each desk.pagedCatalog as item}<tr><td><span class="category-label" title={item.category || '未分类'}>{item.category || '未分类'}</span></td><td title={item.name}><b>{item.name}</b></td><td title={item.source_owner || item.customer_name || '通用'}>{item.source_owner || item.customer_name || '通用'}</td><td title={item.specification || item.remark || '—'}>{item.specification || item.remark || '—'}</td><td title={item.unit}>{item.unit}</td><td class="money" title={desk.money(item.cost_unit)}>{desk.money(item.cost_unit)}</td></tr>{:else}<tr><td colspan="6"><div class="empty-table">当前资料库没有符合条件的条目。{#if filterFields.some((field) => field.value)}<button class="outline-action" type="button" onclick={clearFilters}>清空筛选</button>{/if}</div></td></tr>{/each}</tbody>
    </table></div></div>
    {#if desk.catalogPageCount > 1}
      <nav class="order-pagination catalog-pagination" aria-label="资料库分页">
        <button class="icon-control" title="上一页" aria-label="上一页" disabled={desk.catalogPage === 1} onclick={() => desk.setCatalogPage(desk.catalogPage - 1)}><ChevronLeft size={17} /></button>
        <span class="catalog-page-status">第 {desk.catalogPage} / {desk.catalogPageCount} 页</span>
        <button class="icon-control" title="下一页" aria-label="下一页" disabled={desk.catalogPage === desk.catalogPageCount} onclick={() => desk.setCatalogPage(desk.catalogPage + 1)}><ChevronRight size={17} /></button>
      </nav>
    {/if}
  {/if}
</section>

{#if desk.catalogSourceOpen}
  <div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.catalogSourceOpen = false; }}>
    <div class="project-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-source-title">
      <div class="project-modal-head"><div><p class="section-kicker">新增资料库</p><h2 id="catalog-source-title">新增{desk.catalogKind === 'quote' ? '客户报价库' : '厂商成本库'}</h2><span>{desk.catalogKind === 'quote' ? '同一客户可维护多个报价库；填写客户与报价库名称并上传配置文件。' : '同一厂商可维护多个成本库；填写厂商与成本库名称并上传配置文件。'}</span></div><button class="icon-control" aria-label="关闭新增资料库" onclick={() => desk.catalogSourceOpen = false}><X size={18} /></button></div>
      <form onsubmit={(event) => { event.preventDefault(); desk.submitCatalogSourceForm(); }}>
        <div class="project-modal-body">
          <label>{desk.catalogKind === 'quote' ? '客户公司名称' : '厂商名称'} <em>*</em><input bind:value={desk.catalogSourceName} maxlength="80" placeholder={desk.catalogKind === 'quote' ? '例如：华东科技有限公司' : '例如：硕达'} required /></label>
          <label>{desk.catalogKind === 'quote' ? '报价库名称' : '成本库名称'} <em>*</em><input bind:value={desk.catalogSourceLibraryName} maxlength="80" placeholder={desk.catalogKind === 'quote' ? '例如：2025 年常规报价' : '例如：2025 年材料成本'} required /><small class="field-hint">同一客户或厂商可以建立多个资料库。</small></label>
          <div class="catalog-file-field">
            <span>{desk.catalogKind === 'quote' ? '客户报价配置文件' : '厂商成本配置文件'} <em>*</em></span>
            <label class="upload-action"><Upload size={15} />{desk.catalogSourceFile?.name || '选择配置文件'}<input type="file" accept=".xlsx,.xls,.csv" onchange={desk.onCatalogSourceFileChange} /></label>
            <small class="field-hint">支持 .xlsx / .xls / .csv，上传后自动解析为该资料库的条目。</small>
          </div>
        </div>
        <div class="project-modal-footer"><button type="button" class="outline-action" onclick={() => desk.catalogSourceOpen = false}>取消</button><button type="submit" class="primary-action" disabled={desk.busy || !desk.catalogSourceName?.trim() || !desk.catalogSourceLibraryName?.trim() || !desk.catalogSourceFile}>{desk.busy ? '解析中...' : '下一步：预览并导入'}</button></div>
      </form>
    </div>
  </div>
{/if}

{#if detailSource}
  <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailSource = null; }}>
    <div class="export-drawer catalog-detail-viewer" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title">
      <div class="drawer-head"><div><p class="section-kicker">资料库明细</p><h2 id="catalog-detail-title">{detailSource.owner_name} · {sourceLabel(detailSource)}</h2><span>{detailSource.source_file || '手工配置'} · {detailSource.item_count} 个项目</span></div><button class="icon-control" aria-label="关闭明细" onclick={() => detailSource = null}><X size={17} /></button></div>
      <div class="drawer-body"><label class="search-field"><Search size={16} /><input bind:value={detailSearch} placeholder="搜索名称、分类或制作要求" /></label><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>分类</th><th>名称</th><th>规格 / 要求</th><th>单位</th><th>单价</th></tr></thead><tbody>{#each detailItems() as item}<tr><td>{item.category || '未分类'}</td><td><b>{item.name}</b></td><td>{item.specification || item.remark || '—'}</td><td>{item.unit}</td><td class="money">{desk.money(detailSource.kind === 'quote' ? item.price_incl_tax : item.cost_unit)}</td></tr>{:else}<tr><td colspan="5"><div class="empty-table">没有匹配的资料条目。</div></td></tr>{/each}</tbody></table></div></div></div>
      <div class="drawer-footer"><button class="outline-action" onclick={() => detailSource = null}>关闭</button></div>
    </div>
  </div>
{/if}

{#if desk.catalogImportPreview}
  <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.cancelCatalogImport(); }}>
    <div class="export-drawer catalog-detail-viewer" role="dialog" aria-modal="true" aria-labelledby="catalog-import-title">
      <div class="drawer-head"><div><p class="section-kicker">导入预览</p><h2 id="catalog-import-title">导入预览</h2><span>{desk.catalogImportPreview?.file_name} · {desk.catalogImportPreview?.sheet || '首个工作表'}</span></div><button class="icon-control" aria-label="关闭导入预览" onclick={desk.cancelCatalogImport}><X size={17} /></button></div>
      <div class="drawer-body">
        <div class="import-preview-summary"><div><small>读取行数</small><b>{desk.catalogImportPreview?.total_rows}</b></div><div><small>有效行</small><b>{desk.catalogImportPreview?.valid_rows}</b></div><div><small>忽略行</small><b>{desk.catalogImportPreview?.ignored_rows}</b></div></div>
        {#if !desk.catalogImportTargetId}
          <label class="settings-name-field">{desk.catalogKind === 'quote' ? '客户公司名称' : '厂商名称'}<input bind:value={desk.catalogImportOwner} maxlength="80" placeholder={desk.catalogKind === 'quote' ? '例如：佛山广电' : '例如：硕达'} />{#if desk.catalogKind === 'quote'}<small class="field-hint">按填写内容原样加入订单可选客户</small>{/if}</label>
          <label class="settings-name-field">{desk.catalogKind === 'quote' ? '报价库名称' : '成本库名称'}<input bind:value={desk.catalogImportLibraryName} maxlength="80" placeholder={desk.catalogKind === 'quote' ? '例如：2025 年常规报价' : '例如：2025 年材料成本'} /><small class="field-hint">同一客户或厂商可对应多个资料库。</small></label>
        {/if}
        <div class="import-column-map"><b>识别列</b><span>{previewColumns().join('、') || '未识别到表头'}</span></div>
        <div class="table-panel"><div class="table-scroll"><table><thead><tr>{#each previewColumns() as column}<th>{column}</th>{/each}</tr></thead><tbody>{#each desk.catalogImportPreview?.rows?.slice(0, 10) as row}<tr>{#each previewColumns() as column}<td>{String(row[column] ?? '')}</td>{/each}</tr>{:else}<tr><td colspan={Math.max(previewColumns().length, 1)}><div class="empty-table">没有可导入的有效行</div></td></tr>{/each}</tbody></table></div></div>
        {#if desk.catalogImportPreview?.errors?.length}<div class="import-errors"><b>忽略原因</b><ul>{#each desk.catalogImportPreview.errors.slice(0, 8) as issue}<li>{issue}</li>{/each}</ul></div>{/if}
      </div>
      <div class="drawer-footer"><button class="outline-action" onclick={desk.cancelCatalogImport}>取消</button><button class="primary-action" disabled={desk.busy || !desk.catalogImportPreview?.valid_rows} onclick={desk.confirmCatalogImport}>{desk.busy ? '导入中...' : desk.catalogImportTargetId ? '替换该资料库' : '导入为报价成本资料库'}</button></div>
    </div>
  </div>
{/if}
