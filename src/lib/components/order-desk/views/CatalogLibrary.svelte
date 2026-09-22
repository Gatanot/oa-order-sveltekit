<script lang="ts">
  import { getContext } from 'svelte';
  import { Building2, ChevronLeft, ChevronRight, Factory, FileSpreadsheet, Plus, Search, Upload, X } from 'lucide-svelte';
  const desk = getContext<any>('order-desk');
  let detailSource = $state<any>(null);
  let detailSearch = $state('');
  const sources = () => desk.catalogSources.filter((source: any) => source.kind === desk.catalogKind);
  const detailItems = () => {
    const keyword = detailSearch.trim().toLowerCase();
    return desk.catalog.filter((item: any) => item.source_id === detailSource?.id && (!keyword || `${item.name} ${item.category} ${item.specification || ''} ${item.supplier_remark || ''}`.toLowerCase().includes(keyword)));
  };
  const previewColumns = () => Object.keys(desk.catalogImportPreview?.rows?.[0] || {}).filter((key) => !['source_file', 'source_sheet'].includes(key)).slice(0, 6);
  function closeTopLayer() {
    if (desk.catalogImportPreview) desk.cancelCatalogImport();
    else if (desk.catalogSourceOpen) desk.catalogSourceOpen = false;
    else detailSource = null;
  }
</script>
<svelte:window onkeydown={(event) => { if (event.key === 'Escape') closeTopLayer(); }} />

<section class="page-section">
  <div class="section-heading">
    <div><p class="section-kicker">REFERENCE DATA</p><h2>报价库与成本库</h2><span>{desk.canManageCatalog ? '按客户与厂商维护订单录入所需的价格资料。' : '当前为只读浏览；新增和导入资料仅限财务。'}</span></div>
    {#if desk.canManageCatalog}<div class="top-actions"><button class="outline-action" type="button" onclick={desk.openCatalogSourceForm}><Plus size={16} />新增{desk.catalogKind === 'quote' ? '公司' : '厂商'}</button><label class="upload-action"><Upload size={16} />配置文件<input type="file" accept=".xlsx,.xls,.csv" onchange={desk.importFile} /></label></div>{:else}<span class="readonly-badge">只读</span>{/if}
  </div>

  <div class="catalog-tabs" role="tablist" aria-label="资料库类型">
    <button class:active={desk.catalogKind === 'quote'} onclick={() => desk.catalogKind = 'quote'}><Building2 size={16} />客户报价库</button>
    <button class:active={desk.catalogKind === 'cost'} onclick={() => desk.catalogKind = 'cost'}><Factory size={16} />厂商成本库</button>
  </div>

  <div class="catalog-source-grid">
    {#each sources() as source}
      <div class:active={desk.catalogSourceId === source.id} class="catalog-source-card">
        <button class="catalog-source-select" onclick={() => desk.catalogSourceId = desk.catalogSourceId === source.id ? '' : source.id}><span>{source.kind === 'quote' ? '客户' : '厂商'}</span><b>{source.owner_name}</b><small>{source.item_count} 个项目 · {source.source_file || '手工配置'}</small></button>
        <button class="catalog-source-detail" onclick={() => { detailSearch = ''; detailSource = source; }}>查看明细</button>
      </div>
    {:else}<div class="catalog-empty-source"><FileSpreadsheet size={20} /><span>暂无{desk.catalogKind === 'quote' ? '客户报价' : '厂商成本'}来源</span></div>{/each}
  </div>

  <div class="catalog-filters">
    <label class="search-field"><Search size={16} /><input bind:value={desk.catalogSearch} placeholder="搜索名称、分类、公司或项目" /></label>
    <select bind:value={desk.catalogCategory}><option value="">全部分类</option>{#each desk.catalogCategories as category}<option value={category}>{category}</option>{/each}</select>
    <span>共 {desk.visibleCatalog.length} 条</span>
  </div>
  <div class="table-panel catalog-table-panel"><div class="table-scroll"><table>
    <thead><tr><th>分类</th><th>项目名称</th><th>{desk.catalogKind === 'quote' ? '客户' : '厂商'}</th><th>制作要求 / 备注</th><th>单位</th><th>{desk.catalogKind === 'quote' ? '报价单价' : '成本单价'}</th></tr></thead>
    <tbody>{#each desk.pagedCatalog as item}<tr><td><span class="category-label" title={item.category || '未分类'}>{item.category || '未分类'}</span></td><td title={item.name}><b>{item.name}</b></td><td title={item.source_owner || item.customer_name || '通用'}>{item.source_owner || item.customer_name || '通用'}</td><td title={item.specification || item.supplier_remark || '—'}>{item.specification || item.supplier_remark || '—'}</td><td title={item.unit}>{item.unit}</td><td class="money" title={desk.money(desk.catalogKind === 'quote' ? item.quote_unit : item.cost_unit)}>{desk.money(desk.catalogKind === 'quote' ? item.quote_unit : item.cost_unit)}</td></tr>{:else}<tr><td colspan="6"><div class="empty-table">当前资料库没有符合条件的条目。</div></td></tr>{/each}</tbody>
  </table></div></div>
  {#if desk.catalogPageCount > 1}
    <nav class="order-pagination catalog-pagination" aria-label="资料库分页">
      <button class="icon-control" title="上一页" aria-label="上一页" disabled={desk.catalogPage === 1} onclick={() => desk.setCatalogPage(desk.catalogPage - 1)}><ChevronLeft size={17} /></button>
      <span class="catalog-page-status">第 {desk.catalogPage} / {desk.catalogPageCount} 页</span>
      <button class="icon-control" title="下一页" aria-label="下一页" disabled={desk.catalogPage === desk.catalogPageCount} onclick={() => desk.setCatalogPage(desk.catalogPage + 1)}><ChevronRight size={17} /></button>
    </nav>
  {/if}
</section>

{#if desk.catalogSourceOpen}
  <div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.catalogSourceOpen = false; }}>
    <div class="project-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-source-title">
      <div class="project-modal-head"><div><p class="section-kicker">NEW CATALOG SOURCE</p><h2 id="catalog-source-title">新增{desk.catalogKind === 'quote' ? '客户公司' : '厂商'}</h2><span>可建立空资料库，也可沿用同类型资料库后再调整。</span></div><button class="icon-control" aria-label="关闭新增资料库" onclick={() => desk.catalogSourceOpen = false}><X size={18} /></button></div>
      <form onsubmit={(event) => { event.preventDefault(); desk.createCatalogSourceFromForm(); }}>
        <div class="project-modal-body">
          <label>{desk.catalogKind === 'quote' ? '客户公司名称' : '厂商名称'} <em>*</em><input bind:value={desk.catalogSourceName} maxlength="80" placeholder={desk.catalogKind === 'quote' ? '例如：华东科技有限公司' : '例如：硕达'} required /></label>
          <label>资料库来源<select bind:value={desk.catalogSourceCopyId}><option value="">建立空资料库，稍后上传文件</option>{#each sources() as source}<option value={source.id}>沿用：{source.owner_name}（{source.item_count} 项）</option>{/each}</select></label>
        </div>
        <div class="project-modal-footer"><button type="button" class="outline-action" onclick={() => desk.catalogSourceOpen = false}>取消</button><button type="submit" class="primary-action" disabled={desk.busy}>{desk.busy ? '创建中...' : '保存并继续配置'}</button></div>
      </form>
    </div>
  </div>
{/if}

{#if detailSource}
  <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) detailSource = null; }}>
    <div class="export-drawer catalog-detail-viewer" role="dialog" aria-modal="true" aria-labelledby="catalog-detail-title">
      <div class="drawer-head"><div><p class="section-kicker">CATALOG SOURCE</p><h2 id="catalog-detail-title">{detailSource.owner_name}</h2><span>{detailSource.source_file || '手工配置'} · {detailSource.item_count} 个项目</span></div><button class="icon-control" aria-label="关闭明细" onclick={() => detailSource = null}><X size={17} /></button></div>
      <div class="drawer-body"><label class="search-field"><Search size={16} /><input bind:value={detailSearch} placeholder="搜索名称、分类或制作要求" /></label><div class="table-panel"><div class="table-scroll"><table><thead><tr><th>分类</th><th>名称</th><th>规格 / 要求</th><th>单位</th><th>单价</th></tr></thead><tbody>{#each detailItems() as item}<tr><td>{item.category || '未分类'}</td><td><b>{item.name}</b></td><td>{item.specification || item.supplier_remark || '—'}</td><td>{item.unit}</td><td class="money">{desk.money(detailSource.kind === 'quote' ? item.quote_unit : item.cost_unit)}</td></tr>{:else}<tr><td colspan="5"><div class="empty-table">没有匹配的资料条目。</div></td></tr>{/each}</tbody></table></div></div></div>
      <div class="drawer-footer"><button class="outline-action" onclick={() => detailSource = null}>关闭</button></div>
    </div>
  </div>
{/if}

{#if desk.catalogImportPreview}
  <div class="drawer-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.cancelCatalogImport(); }}>
    <div class="export-drawer catalog-detail-viewer" role="dialog" aria-modal="true" aria-labelledby="catalog-import-title">
      <div class="drawer-head"><div><p class="section-kicker">IMPORT PREVIEW</p><h2 id="catalog-import-title">导入预览</h2><span>{desk.catalogImportPreview.file_name} · {desk.catalogImportPreview.sheet || '首个工作表'}</span></div><button class="icon-control" aria-label="关闭导入预览" onclick={desk.cancelCatalogImport}><X size={17} /></button></div>
      <div class="drawer-body">
        <div class="import-preview-summary"><div><small>读取行数</small><b>{desk.catalogImportPreview.total_rows}</b></div><div><small>有效行</small><b>{desk.catalogImportPreview.valid_rows}</b></div><div><small>忽略行</small><b>{desk.catalogImportPreview.ignored_rows}</b></div></div>
        {#if !desk.catalogSourceId}<label class="settings-name-field">{desk.catalogKind === 'quote' ? '客户公司名称' : '厂商名称'}<input bind:value={desk.catalogImportOwner} maxlength="80" placeholder={desk.catalogKind === 'quote' ? '例如：佛山广电' : '例如：硕达'} /></label>{/if}
        <div class="import-column-map"><b>识别列</b><span>{previewColumns().join('、') || '未识别到表头'}</span></div>
        <div class="table-panel"><div class="table-scroll"><table><thead><tr>{#each previewColumns() as column}<th>{column}</th>{/each}</tr></thead><tbody>{#each desk.catalogImportPreview.rows.slice(0, 10) as row}<tr>{#each previewColumns() as column}<td>{String(row[column] ?? '')}</td>{/each}</tr>{:else}<tr><td colspan={Math.max(previewColumns().length, 1)}><div class="empty-table">没有可导入的有效行</div></td></tr>{/each}</tbody></table></div></div>
        {#if desk.catalogImportPreview.errors.length}<div class="import-errors"><b>忽略原因</b><ul>{#each desk.catalogImportPreview.errors.slice(0, 8) as issue}<li>{issue}</li>{/each}</ul></div>{/if}
      </div>
      <div class="drawer-footer"><button class="outline-action" onclick={desk.cancelCatalogImport}>取消</button><button class="primary-action" disabled={desk.busy || !desk.catalogImportPreview.valid_rows} onclick={desk.confirmCatalogImport}>{desk.busy ? '导入中...' : desk.catalogSourceId ? '替换当前资料库' : '选择归属并导入'}</button></div>
    </div>
  </div>
{/if}
