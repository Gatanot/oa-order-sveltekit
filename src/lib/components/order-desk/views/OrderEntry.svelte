<script lang="ts">
  import { Check, FileText, Paperclip, Plus, Trash2, X } from "lucide-svelte";
  import { getContext } from "svelte";
  const desk = getContext<any>("order-desk");
  function productTotal(p: any) { return (Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2); }
  function costTotal(p: any) { return (Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2); }
  function productMatches(name: string, index: number) {
    const current = desk.products[index];
    if (current?.catalog_id) return [];
    const keyword = name.trim().toLowerCase();
    if (!keyword) return [];
    return desk.catalog
      .filter((item: any) => item.quote_unit > 0 && (!desk.selectedCustomer || !item.customer_name || item.customer_name === desk.selectedCustomer) && (!desk.selectedProject || !item.project_name || item.project_name === desk.selectedProject) && item.name.toLowerCase().includes(keyword))
      .sort((a: any, b: any) => {
        const aExact = a.name.toLowerCase() === keyword ? 1 : 0;
        const bExact = b.name.toLowerCase() === keyword ? 1 : 0;
        const aContext = (a.customer_name === desk.selectedCustomer ? 2 : 0) + (a.project_name === desk.selectedProject ? 1 : 0);
        const bContext = (b.customer_name === desk.selectedCustomer ? 2 : 0) + (b.project_name === desk.selectedProject ? 1 : 0);
        return bExact - aExact || bContext - aContext;
      })
      .slice(0, 6);
  }
  function linkedCost(name: string) {
    const keyword = name.trim().toLowerCase();
    if (!keyword) return null;
    return desk.catalog.find((item: any) => item.name.trim().toLowerCase() === keyword && item.cost_unit > 0 && (!item.quote_unit || item.source_type === "supplier_cost")) || null;
  }
  function costMatches(name: string, index: number) {
    const current = desk.costs[index];
    if (current?.catalog_id) return [];
    const keyword = name.trim().toLowerCase();
    if (!keyword) return [];
    return desk.catalog.filter((item: any) => item.cost_unit > 0 && (!item.quote_unit || item.source_type === "supplier_cost") && item.name.toLowerCase().includes(keyword)).slice(0, 6);
  }
</script>

<section class="entry-layout">
  <form class="order-form" onsubmit={desk.submitOrder} oninput={desk.markOrderDirty}>
    <div class="form-title"><div><p class="section-kicker">ORDER ENTRY</p><h3>{desk.editingOrderId ? "编辑订单" : "新增订单"}</h3><span>订单保存后可在列表中查看、筛选和再次编辑</span></div><button type="button" class="outline-action" onclick={() => desk.navigate("/orders")}>取消</button></div>
    <div class="form-grid">
      <label>客户 <em>*</em><select bind:value={desk.customerId} onchange={desk.onCustomerChange} required><option value="">请选择客户</option>{#each desk.customers as c}<option value={c.id}>{c.name}</option>{/each}</select></label>
      <label>项目 <em>*</em><select bind:value={desk.projectId} required disabled={!desk.customerId}><option value="">请选择项目</option>{#each desk.filteredProjects as p}<option value={p.id}>{p.name} · {p.owner || "未分配"}</option>{/each}</select></label>
      <label>执行公司<select bind:value={desk.executionCompany}><option value="">请选择执行公司</option><option>执行公司一</option><option>执行公司二</option><option>执行公司三</option></select></label>
      <div class="full inline-create"><span>没有找到对应项目？</span><button type="button" onclick={() => desk.showProjectForm = true}><Plus size={14}/>新建项目</button></div>
      <label>客户部门<input bind:value={desk.customerDepartment} placeholder="例如：市场部（可不填）" /></label>
      <label>联系人 / 下单人<input bind:value={desk.contact} placeholder="例如：张三（可不填）" /></label>
      <label class="compact-field">订单日期 <em>*</em><input class="date-input" type="date" bind:value={desk.orderDate} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} required /></label>
      <label class="compact-field">交货日期<input class="date-input" type="date" bind:value={desk.deliveryDate} min={desk.orderDate} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
      <label>指定设计师<input bind:value={desk.designer} placeholder="本订单设计师（可不填）" /></label>
      <label>策划人<input bind:value={desk.planner} placeholder="本订单策划人（可不填）" /></label>
      <label class="compact-field">订单状态<select bind:value={desk.status}><option>制作中</option><option>待确认</option><option>已完成</option></select></label>
      <label class="compact-field">录入人<input bind:value={desk.createdBy} placeholder="请设置填写人" /></label>
      <label class="compact-field">结款状态<select bind:value={desk.paymentStatus}><option>未结款</option><option>已结款</option></select></label>
    </div>

    <div class="detail-editor"><div class="editor-heading"><h3>产品明细</h3><button type="button" class="outline-action" onclick={desk.addProduct}><Plus size={15}/>添加产品</button></div>
      {#if desk.products.length}<div class="repeat-header editor-row" aria-hidden="true"><span>产品名称 · 可匹配报价库</span><span>单位</span><span>数量</span><span>销售单价（元）</span><span>小计（元）</span><span></span></div>{/if}
      {#each desk.products as product, i}
        <div class="repeat-row editor-row"><div class:catalog-matched={Boolean(product.catalog_id)} class="autocomplete-field"><input value={product.name} oninput={(e) => desk.updateProduct(i, 'name', e.currentTarget.value)} onblur={() => setTimeout(() => desk.matchProductCatalog(i), 120)} placeholder="输入产品名称以匹配报价库" />{#if product.catalog_id}<span class="catalog-match-mark" title="已匹配报价库"><Check size={13} />已匹配</span>{/if}{#if product.name && productMatches(product.name, i).length}<div class="suggestion-menu">{#each productMatches(product.name, i) as item}<button type="button" onmousedown={(event) => event.preventDefault()} onclick={() => desk.applyProductCatalog(i, item.id)}><span>{item.name}</span><small>{item.unit} · ¥{(item.quote_unit / 100).toFixed(2)} · {item.category || "报价库"}{item.source_owner || item.customer_name ? ` · ${item.source_owner || item.customer_name}` : ''}</small>{#if item.specification}<small class="suggestion-spec">{item.specification}</small>{/if}</button>{/each}</div>{/if}</div><input value={product.unit} oninput={(e) => desk.updateProduct(i, 'unit', e.currentTarget.value)} placeholder="单位" /><input type="number" inputmode="decimal" min="0.01" step="any" value={product.quantity} aria-label={`第 ${i + 1} 项产品数量`} oninput={(e) => desk.updateProduct(i, 'quantity', e.currentTarget.value)} placeholder="数量" /><input type="number" inputmode="decimal" min="0" step="0.01" value={product.unit_price} aria-label={`第 ${i + 1} 项产品销售单价`} oninput={(e) => desk.updateProduct(i, 'unit_price', e.currentTarget.value)} placeholder="销售单价" /><input readonly aria-label={`第 ${i + 1} 项产品小计`} value={productTotal(product)} placeholder="小计" /><button type="button" class="delete-action" onclick={() => desk.removeProduct(i)} aria-label="删除产品"><Trash2 size={15}/></button><textarea value={product.specification || ''} oninput={(e) => desk.updateProduct(i, 'specification', e.currentTarget.value)} placeholder="规格及制作要求（选填）"></textarea>{#if linkedCost(product.name)}<small class="linked-cost-hint">成本库同名关联：{linkedCost(product.name).name} · {linkedCost(product.name).unit} · 成本单价 ¥{(linkedCost(product.name).cost_unit / 100).toFixed(2)}</small>{/if}</div>
      {:else}<p class="empty-table">请添加至少一项产品</p>{/each}
    </div>
    <div class="detail-editor"><div class="editor-heading"><h3>固定厂商成本</h3><button type="button" class="outline-action" onclick={desk.addCost}><Plus size={15}/>添加成本项目</button></div>
      {#if desk.costs.length}<div class="repeat-header cost-editor-row" aria-hidden="true"><span>成本项目 · 可匹配成本库</span><span>供应商</span><span>单位</span><span>数量</span><span>成本单价（元）</span><span>小计（元）</span><span></span></div>{/if}
      {#each desk.costs as cost, i}<div class="repeat-row cost-editor-row"><div class="autocomplete-field"><input value={cost.name} oninput={(e) => desk.updateCost(i, 'name', e.currentTarget.value)} placeholder="成本项目" />{#if cost.name && costMatches(cost.name, i).length}<div class="suggestion-menu">{#each costMatches(cost.name, i) as item}<button type="button" onclick={() => desk.applyCostCatalog(i, item.id)}><span>{item.name}</span><small>{item.source_owner || item.supplier_remark || "成本库"} · {item.unit} · ¥{(item.cost_unit / 100).toFixed(2)}</small></button>{/each}</div>{/if}</div><input value={cost.vendor} oninput={(e) => desk.updateCost(i, 'vendor', e.currentTarget.value)} placeholder="供应商" /><input value={cost.unit || ''} oninput={(e) => desk.updateCost(i, 'unit', e.currentTarget.value)} placeholder="单位" /><input type="number" inputmode="decimal" min="0.01" step="any" value={cost.quantity} aria-label={`第 ${i + 1} 项成本数量`} oninput={(e) => desk.updateCost(i, 'quantity', e.currentTarget.value)} placeholder="数量" /><input type="number" inputmode="decimal" min="0" step="0.01" value={cost.unit_price} aria-label={`第 ${i + 1} 项成本单价`} oninput={(e) => desk.updateCost(i, 'unit_price', e.currentTarget.value)} placeholder="成本单价" /><input readonly aria-label={`第 ${i + 1} 项成本小计`} value={costTotal(cost)} placeholder="小计" /><button type="button" class="delete-action" onclick={() => desk.removeCost(i)} aria-label="删除成本"><Trash2 size={15}/></button></div>{/each}
    </div>
    <div class="detail-editor"><div class="editor-heading"><h3>员工垫付</h3><button type="button" class="outline-action" onclick={desk.addAdvance}><Plus size={15}/>添加垫付</button></div>
      {#if desk.advances.length}<div class="repeat-header advance-editor-row" aria-hidden="true"><span>垫付员工</span><span>垫付物品</span><span>金额（元）</span><span>垫付日期</span><span>发票附件</span><span>状态</span><span></span></div>{/if}
      {#each desk.advances as advance, i}<div class="repeat-row advance-editor-row"><input value={advance.employee || ''} readonly={!desk.canEditAdvance(advance)} oninput={(e) => desk.updateAdvance(i, 'employee', e.currentTarget.value)} placeholder="垫付员工" /><input value={advance.item} readonly={!desk.canEditAdvance(advance)} oninput={(e) => desk.updateAdvance(i, 'item', e.currentTarget.value)} placeholder="垫付物品" /><input type="number" inputmode="decimal" min="0" step="0.01" value={advance.amount} readonly={!desk.canEditAdvance(advance)} aria-label={`第 ${i + 1} 项垫付金额`} oninput={(e) => desk.updateAdvance(i, 'amount', e.currentTarget.value)} placeholder="金额" /><input class="date-input" type="date" value={advance.date} disabled={!desk.canEditAdvance(advance)} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} oninput={(e) => desk.updateAdvance(i, 'date', e.currentTarget.value)} /><div class="invoice-upload"><label class="upload-action upload-action-small"><Paperclip size={13}/>{advance.invoiceFile ? "重新选择" : "上传发票"}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" disabled={desk.uploadingFiles || !desk.canEditAdvance(advance)} onchange={(e) => desk.onAdvanceInvoiceChange(e, i)} /></label>{#if advance.invoiceFile}<button class="upload-name invoice-name local-preview-action" type="button" onclick={() => desk.openLocalAttachmentPreview(advance.invoiceFile)} title="在当前页面预览"><FileText size={12}/>{advance.invoice}</button><button type="button" class="upload-remove" disabled={!desk.canEditAdvance(advance)} aria-label={`移除发票 ${advance.invoice}`} onclick={() => desk.removeAdvanceInvoice(i)}><X size={13}/></button>{:else}<small class="field-hint">{advance.invoice || "图片或 PDF"}</small>{/if}</div><span class="field-hint" title={desk.canEditAdvance(advance) ? "" : "已进入报销流程，请在报销页处理"}>{advance.status || "待审核"}</span><button type="button" class="delete-action" disabled={!desk.canEditAdvance(advance)} onclick={() => desk.removeAdvance(i)} aria-label="删除垫付"><Trash2 size={15}/></button></div>{/each}
    </div>
    <datalist id="catalog-names">{#each desk.catalog.filter((item: any) => item.quote_unit > 0) as item}<option value={item.name}>{item.category}</option>{/each}</datalist>
    <datalist id="cost-names">{#each desk.catalog.filter((item: any) => item.cost_unit > 0) as item}<option value={item.name}>{item.category}</option>{/each}</datalist>
    <div class="form-grid"><label class="full">备注 / 制作要求<textarea bind:value={desk.note} placeholder="补充交付说明、来源或其他需要留痕的信息"></textarea></label>
      <div class="full upload-field">
        <span class="upload-label">备注附件 <small class="optional-mark">支持图片和 PDF，单个不超过 10MB</small></span>
        <div class="upload-row">
          <label class="upload-action"><Paperclip size={14}/>选择文件<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" multiple disabled={desk.uploadingFiles} onchange={desk.onNoteFilesChange} /></label>
          <span class="field-hint">{desk.noteFiles.length ? `已选择 ${desk.noteFiles.length} 个文件，保存订单时上传` : "可选择发票、付款截图等文件"}</span>
        </div>
        {#if desk.noteFiles.length}
          <ul class="upload-list">{#each desk.noteFiles as file, i}<li><button class="upload-name local-preview-action" type="button" onclick={() => desk.openLocalAttachmentPreview(file)} title="在当前页面预览"><FileText size={13}/>{file.name}</button><small>{desk.formatFileSize(file.size)}</small><button type="button" class="upload-remove" aria-label={`移除 ${file.name}`} onclick={() => desk.removeNoteFile(i)}><X size={13}/></button></li>{/each}</ul>
        {/if}
      </div>
    </div>
    <div class="form-footer"><span>至少添加一项产品；含员工垫付的订单会自动进入报销核验。</span><div class="submit-dropdown"><button class="primary-action" disabled={desk.busy || desk.uploadingFiles || !desk.projectId}>{desk.busy || desk.uploadingFiles ? "保存中..." : "保存订单"}</button></div></div>
  </form>
</section>
