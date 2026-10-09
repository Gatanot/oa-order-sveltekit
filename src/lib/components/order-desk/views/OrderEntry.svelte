<script lang="ts">
  import { Check, FileText, Library, Paperclip, Plus, Trash2, X } from "lucide-svelte";
  import { getContext } from "svelte";
  const desk = getContext<any>("order-desk");
  function productTotal(p: any) { return (Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2); }
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
</script>

<section class="entry-layout">
  <form class="order-form" onsubmit={desk.submitOrder} oninput={desk.markOrderDirty}>
    <div class="form-title"><div><p class="section-kicker">订单录入</p><h3>{desk.editingOrderId ? "编辑订单" : "新增订单"}</h3><span>订单保存后可在列表中查看、筛选和再次编辑</span></div><button type="button" class="outline-action" onclick={() => desk.navigate("/orders")}>取消</button></div>
    <div class="form-grid">
      <label>客户 <em>*</em><select bind:value={desk.customerId} onchange={desk.onCustomerChange} required><option value="">请选择客户</option>{#each desk.customers as c}<option value={c.id}>{c.name}</option>{/each}</select></label>
      <label>项目 <em>*</em><div class="field-with-action"><select bind:value={desk.projectId} required disabled={!desk.customerId}><option value="">请选择项目</option>{#each desk.filteredProjects as p}<option value={p.id}>{p.name} · {p.owner || "未分配"}</option>{/each}</select><button type="button" class="mini-create" disabled={!desk.customerId} title={desk.customerId ? "新增项目" : "请先选择客户"} onclick={() => (desk.showProjectForm = !desk.showProjectForm)}><Plus size={14}/>新建项目</button></div></label>
      {#if desk.showProjectForm}
        <div class="full inline-create-form">
          <label>新项目名称 <em>*</em><input bind:value={desk.newProject} placeholder="例如：办公楼改造项目" /></label>
          <label>项目负责人<input bind:value={desk.newOwner} placeholder="例如：张三（可不填）" /></label>
          <div class="inline-create-actions"><button type="button" class="outline-action" onclick={() => (desk.showProjectForm = false)}>取消</button><button type="button" class="primary-action" disabled={desk.busy || !desk.newProject.trim()} onclick={desk.submitProject}>{desk.busy ? "保存中..." : "保存项目"}</button></div>
        </div>
      {/if}
      <label>执行公司<div class="field-with-action"><select bind:value={desk.executionCompany}><option value="">请选择执行公司</option>{#each desk.executionCompanyOptions as company}<option>{company}</option>{/each}</select><button type="button" class="mini-create" title="新增执行公司" onclick={() => desk.toggleExecutionCompanyForm()}><Plus size={14}/>新增</button></div></label>
      {#if desk.showExecutionCompanyForm}
        <div class="full inline-create-form">
          <label>新的执行公司名称<input bind:value={desk.newExecutionCompany} placeholder="输入执行公司名称" /></label>
          <div class="inline-create-actions"><button type="button" class="outline-action" onclick={() => desk.toggleExecutionCompanyForm()}>取消</button><button type="button" class="primary-action" disabled={!desk.newExecutionCompany.trim()} onclick={desk.addExecutionCompany}>保存</button></div>
        </div>
      {/if}
      <label>客户部门<input bind:value={desk.customerDepartment} placeholder="例如：市场部（可不填）" /></label>
      <label>联系人 / 下单人<input bind:value={desk.contact} placeholder="例如：张三（可不填）" /></label>
      <label class="compact-field">订单日期 <em>*</em><input class="date-input" type="date" bind:value={desk.orderDate} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} required /></label>
      <label class="compact-field">交货日期<input class="date-input" type="date" bind:value={desk.deliveryDate} min={desk.orderDate} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
      <label>指定设计师<select value={desk.designerUid ?? ""} onchange={(event) => { const uid = Number(event.currentTarget.value) || null; desk.designerUid = uid; desk.designer = desk.employees.find((employee: any) => employee.catsco_uid === uid)?.display_name || ""; }}><option value="">暂不指定</option>{#each desk.employees.filter((employee: any) => employee.role === 'designer') as employee}<option value={employee.catsco_uid}>{employee.display_name} · 编号 {employee.catsco_uid}{employee.department ? ` · ${employee.department}` : ''}</option>{/each}</select></label>
      <label>指定策划人<select value={desk.plannerUid ?? ""} onchange={(event) => { const uid = Number(event.currentTarget.value) || null; desk.plannerUid = uid; desk.planner = desk.employees.find((employee: any) => employee.catsco_uid === uid)?.display_name || ""; }}><option value="">暂不指定</option>{#each desk.employees.filter((employee: any) => employee.role === 'planner') as employee}<option value={employee.catsco_uid}>{employee.display_name} · 编号 {employee.catsco_uid}{employee.department ? ` · ${employee.department}` : ''}</option>{/each}</select></label>
      <label class="compact-field">订单状态<select bind:value={desk.status}><option>已提交</option><option>已完成</option></select></label>
      <label class="compact-field">录入人<input value={desk.createdBy} readonly title="录入人取自 Catsco 登录用户名，不可修改" /></label>
      <label class="compact-field">结款状态<select bind:value={desk.paymentStatus}><option>未结款</option><option>已结款</option></select></label>
    </div>

    <div class="detail-editor"><div class="editor-heading"><h3>产品明细与成本</h3><button type="button" class="outline-action" onclick={desk.addProduct}><Plus size={15}/>添加产品</button></div>
      {#if desk.products.length}<div class="repeat-header editor-row" aria-hidden="true"><span>产品名称 · 可匹配报价库</span><span>单位</span><span>数量</span><span>销售单价（元）</span><span>成本单价（元）</span><span>供应商 · 同名成本自动匹配</span><span>小计（元）</span><span></span></div>{/if}
      {#each desk.products as product, i}
        <div class="repeat-row editor-row"><span class="row-index" aria-hidden="true">{i + 1}</span><div class="product-name-cell"><div class:catalog-matched={Boolean(product.catalog_id)} class="autocomplete-field"><input value={product.name} oninput={(e) => desk.updateProduct(i, 'name', e.currentTarget.value)} onblur={() => setTimeout(() => desk.matchProductCatalog(i), 120)} placeholder="输入产品名称以匹配报价库" />{#if product.catalog_id}<span class="catalog-match-mark" title="已匹配报价库"><Check size={13} />已匹配</span>{/if}{#if product.name && productMatches(product.name, i).length}<div class="suggestion-menu">{#each productMatches(product.name, i) as item}<button type="button" onmousedown={(event) => event.preventDefault()} onclick={() => desk.applyProductCatalog(i, item.id)}><span>{item.name}</span><small>{item.unit} · ¥{(item.quote_unit / 100).toFixed(2)} · {item.category || "报价库"}{item.source_owner || item.customer_name ? ` · ${item.source_owner || item.customer_name}` : ''}</small>{#if item.specification}<small class="suggestion-spec">{item.specification}</small>{/if}</button>{/each}</div>{/if}</div></div><input value={product.unit} oninput={(e) => desk.updateProduct(i, 'unit', e.currentTarget.value)} placeholder="单位" /><input type="number" inputmode="decimal" min="0.01" step="any" value={product.quantity} aria-label={`第 ${i + 1} 项产品数量`} oninput={(e) => desk.updateProduct(i, 'quantity', e.currentTarget.value)} placeholder="数量" /><input type="number" inputmode="decimal" min="0" step="0.01" value={product.unit_price} aria-label={`第 ${i + 1} 项产品销售单价`} oninput={(e) => desk.updateProduct(i, 'unit_price', e.currentTarget.value)} placeholder="销售单价" /><div class="autocomplete-field cost-field"><input type="number" inputmode="decimal" min="0" step="0.01" value={product.cost_unit} aria-label={`第 ${i + 1} 项产品成本单价`} oninput={(e) => desk.updateProduct(i, 'cost_unit', e.currentTarget.value)} placeholder="成本单价" /><button type="button" class="cost-picker-toggle" title="从成本库选择" aria-label={`从成本库选择第 ${i + 1} 项成本`} onclick={(event) => { event.stopPropagation(); desk.toggleCostPicker(i); }}><Library size={13} /></button>{#if desk.costPickerIndex === i}<div class="suggestion-menu cost-suggestion-menu">{#each desk.costOptions(i) as item}<button type="button" onmousedown={(event) => event.preventDefault()} onclick={() => desk.applyCostOption(i, item)}><span>{item.name}</span><small>¥{(item.cost_unit / 100).toFixed(2)} · {item.unit || "项"}{item.category ? ` · ${item.category}` : ""}{item.source_owner || item.customer_name ? ` · ${item.source_owner || item.customer_name}` : ""}</small></button>{:else}<span class="muted cost-empty">成本库暂无可选成本项</span>{/each}</div>{/if}</div><div class="autocomplete-field"><input value={product.vendor || ''} oninput={(e) => desk.updateProduct(i, 'vendor', e.currentTarget.value)} placeholder="供应商（自动匹配）" />{#if product.cost_catalog_id}<span class="catalog-match-mark" title="已匹配成本库"><Check size={13} />已匹配</span>{/if}</div><input readonly aria-label={`第 ${i + 1} 项产品小计`} value={productTotal(product)} placeholder="小计" /><button type="button" class="delete-action" onclick={() => desk.removeProduct(i)} aria-label="删除产品"><Trash2 size={15}/></button><textarea value={product.specification || ''} oninput={(e) => desk.updateProduct(i, 'specification', e.currentTarget.value)} placeholder="规格及制作要求（选填）"></textarea></div>
      {:else}<p class="empty-table">请添加至少一项产品</p>{/each}
    </div>
    <div class="form-grid"><label class="full">备注 / 制作要求<textarea bind:value={desk.note} placeholder="补充交付说明、来源或其他需要留痕的信息"></textarea></label>
      <div class="full upload-field">
        <span class="upload-label">备注附件 <small class="optional-mark">支持图片和 PDF，单个不超过 10MB</small></span>
        <div class="upload-row">
          <label class="upload-action"><Paperclip size={14}/>选择文件<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" multiple disabled={desk.uploadingFiles} onchange={desk.onNoteFilesChange} /></label>
          <span class="field-hint">{desk.noteFiles.length ? `已选择 ${desk.noteFiles.length} 个文件，保存订单时上传` : "甲方的初始要求以及素材"}</span>
        </div>
        {#if desk.noteFiles.length}
          <ul class="upload-list">{#each desk.noteFiles as file, i}<li><button class="upload-name local-preview-action" type="button" onclick={() => desk.openLocalAttachmentPreview(file)} title="在当前页面预览"><FileText size={13}/>{file.name}</button><small>{desk.formatFileSize(file.size)}</small><button type="button" class="upload-remove" aria-label={`移除 ${file.name}`} onclick={() => desk.removeNoteFile(i)}><X size={13}/></button></li>{/each}</ul>
        {/if}
      </div>
    </div>
    <div class="form-footer"><span>至少添加一项产品；填写产品名称会自动匹配同名的报价和成本项。</span><div class="submit-dropdown"><button class="primary-action" disabled={desk.busy || desk.uploadingFiles || !desk.projectId}>{desk.busy || desk.uploadingFiles ? "保存中..." : "保存订单"}</button></div></div>
  </form>
</section>
