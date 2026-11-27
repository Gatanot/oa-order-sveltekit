<script lang="ts">
  import { Check, FileText, Library, MessageSquareText, Paperclip, Plus, Trash2, X } from "lucide-svelte";
  import { getContext } from "svelte";
  const desk = getContext<any>("order-desk");
  let costDrafts = $state<Record<string, string>>({});
  // 项目目前只在录入页维护：这里提供与「新建项目」对称的删除入口，项目下有订单时由服务端拒绝。
  function deleteSelectedProject() {
    const project = desk.projects.find((item: any) => item.id === desk.projectId);
    if (project) desk.deleteProject(project);
  }
  function productTotal(p: any) { return (Number(p.quantity || 0) * Number(p.unit_price || 0)).toFixed(2); }
  function productCostTotal(p: any) { return (Number(p.quantity || 0) * Number(p.cost_unit || 0)).toFixed(2); }
  function extraCostTotal(p: any) { return (p.extra_costs || []).reduce((sum: number, extra: any) => sum + (Number(extra.amount) || 0), 0); }
  function rowCostTotal(p: any) { return Number(productCostTotal(p)) + extraCostTotal(p); }
  function extraCostCount(p: any) { return (p.extra_costs || []).length; }
  function costInputValue(p: any) { return costDrafts[p?.line_id] ?? productCostTotal(p); }
  function beginCostEdit(p: any) { if (p?.line_id) costDrafts[p.line_id] = productCostTotal(p); }
  function editCost(index: number, p: any, event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (p?.line_id) costDrafts[p.line_id] = value;
    desk.updateProductCost(index, value);
  }
  function endCostEdit(p: any) { if (p?.line_id) delete costDrafts[p.line_id]; }
  // 规格和技术要求是本行最长的自由文本：随内容自动增高（36px 起，最多约 4 行），避免只能看到一行。
  const SPEC_MIN_HEIGHT = 36;
  const SPEC_MAX_HEIGHT = 90;
  function resizeSpecField(field: HTMLTextAreaElement | null) {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(Math.max(field.scrollHeight, SPEC_MIN_HEIGHT), SPEC_MAX_HEIGHT)}px`;
  }
  // 报价库会把规格一次性写入，需要等 DOM 更新后再按新内容重算高度。
  function resizeSpecFieldAt(index: number) {
    requestAnimationFrame(() => resizeSpecField(document.querySelector<HTMLTextAreaElement>(`textarea[data-spec-index="${index}"]`)));
  }
  // 行备注是选填项，默认收在按钮后，有内容或手动展开时才占一行，避免每行产品都白占一整行。
  let remarkOpen = $state<Record<string, boolean>>({});
  function remarkVisible(product: any) {
    const explicit = remarkOpen[product.line_id];
    return explicit === undefined ? Boolean(String(product.remark || "").trim()) : explicit;
  }
  function toggleRemark(product: any, index: number) {
    const next = !remarkVisible(product);
    remarkOpen[product.line_id] = next;
    if (next) requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`input[data-remark-index="${index}"]`)?.focus());
  }
  function productMatches(name: string, index: number) {
    const current = desk.products[index];
    if (current?.catalog_id) return [];
    const keyword = name.trim().toLowerCase();
    if (!keyword) return [];
    return desk.catalogQuote
      .filter((item: any) => item.price_incl_tax > 0 && (!desk.selectedCustomer || !item.customer_name || item.customer_name === desk.selectedCustomer) && (!desk.selectedProject || !item.project_name || item.project_name === desk.selectedProject) && item.name.toLowerCase().includes(keyword))
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
      <label>客户 <em>*</em><select bind:value={desk.customerId} onchange={desk.onCustomerChange} required><option value="">{desk.customers.length ? "请选择客户" : "暂无客户，请先在客户管理中新增客户"}</option>{#each desk.customers as c}<option value={c.id}>{c.name}</option>{/each}</select></label>
      <label>项目 <span class="optional-mark">选填</span><div class="field-with-action"><select bind:value={desk.projectId} disabled={!desk.customerId}><option value="">不关联项目（自动归入非分配项目）</option>{#each desk.filteredProjects as p}<option value={p.id}>{p.name} · {p.owner || "未分配"}</option>{/each}</select><button type="button" class="mini-create" disabled={!desk.customerId} title={desk.customerId ? "新增项目" : "请先选择客户"} onclick={() => (desk.showProjectForm = !desk.showProjectForm)}><Plus size={14}/>新建项目</button>{#if desk.canManageOrders}<button type="button" class="icon-control project-delete" title={desk.projectId ? "删除当前项目" : "请先选择要删除的项目"} aria-label="删除当前项目" disabled={!desk.projectId || desk.busy} onclick={deleteSelectedProject}><Trash2 size={15}/></button>{/if}</div></label>
      {#if desk.showProjectForm}
        <div class="full inline-create-form">
          <label>新项目名称 <em>*</em><input bind:value={desk.newProject} placeholder="例如：办公楼改造项目" /></label>
          <label>项目负责人<input bind:value={desk.newOwner} placeholder="例如：张三（可不填）" /></label>
          <div class="inline-create-actions"><button type="button" class="outline-action" onclick={() => (desk.showProjectForm = false)}>取消</button><button type="button" class="primary-action" disabled={desk.busy || !desk.newProject.trim()} onclick={desk.submitProject}>{desk.busy ? "保存中..." : "保存项目"}</button></div>
        </div>
      {/if}
      <label>执行公司<select bind:value={desk.executionCompany}><option value="">请选择执行公司</option>{#each desk.executionCompanyOptions as company}<option>{company}</option>{/each}</select></label>
      <label>订单来源<input bind:value={desk.orderSource} placeholder="例如：市场部-张三（可不填）" /></label>
      <label class="compact-field">订单日期 <em>*</em><input class="date-input" type="date" bind:value={desk.orderDate} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} required /></label>
      <label class="compact-field">交货日期<input class="date-input" type="date" bind:value={desk.deliveryDate} min={desk.orderDate} onclick={(event) => (event.currentTarget as HTMLInputElement).showPicker?.()} /></label>
      <label>指定设计师<select value={desk.designerUid ?? ""} onchange={(event) => { const uid = Number(event.currentTarget.value) || null; desk.designerUid = uid; desk.designer = desk.employees.find((employee: any) => employee.catsco_uid === uid)?.display_name || ""; }}><option value="">暂不指定</option>{#each desk.employees.filter((employee: any) => employee.role === 'designer') as employee}<option value={employee.catsco_uid}>{employee.display_name} · 编号 {employee.catsco_uid}{employee.department ? ` · ${employee.department}` : ''}</option>{/each}</select></label>
      <label>指定策划人<select value={desk.plannerUid ?? ""} onchange={(event) => { const uid = Number(event.currentTarget.value) || null; desk.plannerUid = uid; desk.planner = desk.employees.find((employee: any) => employee.catsco_uid === uid)?.display_name || ""; }}><option value="">暂不指定</option>{#each desk.employees.filter((employee: any) => employee.role === 'planner') as employee}<option value={employee.catsco_uid}>{employee.display_name} · 编号 {employee.catsco_uid}{employee.department ? ` · ${employee.department}` : ''}</option>{/each}</select></label>
      <label class="compact-field">订单状态<select bind:value={desk.status}><option>已提交</option><option>已完成</option></select></label>
      <label class="compact-field">录入人<input value={desk.createdBy} readonly title="录入人取自员工档案姓名，不可修改" /></label>
      <label class="compact-field">结款状态<select bind:value={desk.paymentStatus}><option>未结款</option><option>已结款</option></select></label>
    </div>

    <div class="detail-editor"><div class="editor-heading"><h3>下单明细</h3><button type="button" class="outline-action" onclick={desk.addProduct}><Plus size={15}/>添加产品</button></div>
      {#if desk.products.length}
        <div class="repeat-header editor-row" aria-hidden="true"><span class="row-index-head">序号</span><div class="repeat-header-fields"><span title="输入产品名称会自动匹配报价库">产品名称</span><span class="head-spec">规格和技术要求</span><span>数量</span><span>单位</span><span>单价（元）</span><span>小计（元）</span><span title="同名产品自动匹配成本库">供应商</span><span>成本（元）</span><span title="个人垫付">垫付</span><span></span></div></div>
      {/if}
      {#each desk.products as product, i (product.line_id || i)}
        <div class="product-row">
          <span class="row-index" aria-hidden="true">{i + 1}</span>
          <div class="repeat-row editor-row">
            <div class="product-name-cell"><div class:catalog-matched={Boolean(product.catalog_id)} class="autocomplete-field"><input value={product.name} title={product.name || '输入产品名称可自动匹配报价库'} oninput={(e) => desk.updateProduct(i, 'name', e.currentTarget.value)} onblur={() => setTimeout(() => desk.matchProductCatalog(i), 120)} placeholder="产品或报价库名称" />{#if product.catalog_id}<span class="catalog-match-mark" title="已匹配报价库"><Check size={13} /></span>{/if}{#if product.name && productMatches(product.name, i).length}<div class="suggestion-menu">{#each productMatches(product.name, i) as item}<button type="button" onmousedown={(event) => event.preventDefault()} onclick={() => { desk.applyProductCatalog(i, item.id); resizeSpecFieldAt(i); }}><span>{item.name}</span><small>{item.unit} · ¥{(item.price_incl_tax / 100).toFixed(2)} · {item.category || "报价库"}{item.source_owner || item.customer_name ? ` · ${item.source_owner || item.customer_name}` : ''}</small>{#if item.specification}<small class="suggestion-spec">{item.specification}</small>{/if}</button>{/each}</div>{/if}</div></div>
            <div class="product-spec-cell">
              <textarea class="product-spec-field" data-spec-index={i} rows={1} aria-label={`第 ${i + 1} 项规格和技术要求`} value={product.specification || ''} use:resizeSpecField oninput={(e) => { desk.updateProduct(i, 'specification', e.currentTarget.value); resizeSpecField(e.currentTarget); }} placeholder="规格和技术要求，可换行"></textarea>
            </div>
            <input type="number" inputmode="decimal" min="0.01" step="any" value={product.quantity} aria-label={`第 ${i + 1} 项产品数量`} oninput={(e) => desk.updateProduct(i, 'quantity', e.currentTarget.value)} placeholder="数量" />
            <input value={product.unit} oninput={(e) => desk.updateProduct(i, 'unit', e.currentTarget.value)} placeholder="单位" />
            <input type="number" inputmode="decimal" min="0" step="0.01" value={product.unit_price} aria-label={`第 ${i + 1} 项产品单价`} oninput={(e) => desk.updateProduct(i, 'unit_price', e.currentTarget.value)} placeholder="单价" />
            <input readonly aria-label={`第 ${i + 1} 项产品小计`} value={productTotal(product)} placeholder="小计" />
            <div class:catalog-matched={Boolean(product.cost_catalog_id)} class="autocomplete-field"><input value={product.vendor || ''} title={product.cost_catalog_id ? `已匹配成本库：${product.vendor || ''}` : '同名产品会自动匹配成本库'} oninput={(e) => desk.updateProduct(i, 'vendor', e.currentTarget.value)} placeholder="供应商" /></div>
            <div class:catalog-matched={Boolean(product.cost_catalog_id)} class="autocomplete-field cost-field"><input type="number" inputmode="decimal" min="0" step="any" value={costInputValue(product)} aria-label={`第 ${i + 1} 项产品成本`} onfocus={() => beginCostEdit(product)} oninput={(e) => editCost(i, product, e)} onblur={() => endCostEdit(product)} placeholder="成本" /><button type="button" class="cost-picker-toggle" title="从成本库选择" aria-label={`从成本库选择第 ${i + 1} 项成本`} onclick={(event) => { event.stopPropagation(); desk.toggleCostPicker(i); }}><Library size={13} /></button>{#if desk.costPickerIndex === i}<div class="suggestion-menu cost-suggestion-menu">{#each desk.costOptions(i) as item}<button type="button" onmousedown={(event) => event.preventDefault()} onclick={() => desk.applyCostOption(i, item)}><span>{item.name}</span><small>¥{(item.cost_unit / 100).toFixed(2)} · {item.unit || "项"}{item.category ? ` · ${item.category}` : ""}{item.source_owner || item.customer_name ? ` · ${item.source_owner || item.customer_name}` : ""}</small></button>{:else}<span class="muted cost-empty">成本库暂无可选成本项</span>{/each}</div>{/if}</div>
            <div class="advance-cell">
              <button type="button" role="switch" aria-checked={Boolean(product.advance)} aria-label={`第 ${i + 1} 项个人垫付`} class="advance-switch" class:is-on={Boolean(product.advance)} onclick={() => desk.updateProduct(i, 'advance', !product.advance)}>
                <span class="advance-track" aria-hidden="true"><span class="advance-thumb"></span></span>
              </button>
            </div>
            <div class="row-actions">
              <button type="button" class="extra-cost-toggle" class:has-content={extraCostCount(product) > 0} aria-label={`为第 ${i + 1} 项添加额外成本`} title="添加额外成本 / 供应商（不匹配成本库）" onclick={() => desk.addExtraCost(i)}><Plus size={14} />{#if extraCostCount(product) > 0}<span class="extra-cost-count">{extraCostCount(product)}</span>{/if}</button>
              <button type="button" class="remark-toggle" class:has-content={Boolean(String(product.remark || '').trim())} class:is-open={remarkVisible(product)} aria-expanded={remarkVisible(product)} aria-label={`第 ${i + 1} 项行备注`} title={remarkVisible(product) ? '收起行备注' : '添加行备注（选填）'} onclick={() => toggleRemark(product, i)}><MessageSquareText size={14} /></button>
              <button type="button" class="delete-action" onclick={() => desk.removeProduct(i)} aria-label="删除产品"><Trash2 size={15}/></button>
            </div>
            {#if remarkVisible(product)}
              <input class="product-remark-field" data-remark-index={i} aria-label={`第 ${i + 1} 项行备注`} title="行备注（选填）" value={product.remark || ''} oninput={(e) => desk.updateProduct(i, 'remark', e.currentTarget.value)} placeholder="行备注（选填）" />
            {/if}
          </div>
          {#if extraCostCount(product) > 0}
            <div class="extra-cost-editor">
              <div class="extra-cost-heading">
                <div><b>额外成本</b><small>机动补充，不要求匹配成本库或报价库</small></div>
                <span>本行成本合计 ¥{rowCostTotal(product).toFixed(2)}</span>
              </div>
              <div class="extra-cost-list">
                <div class="extra-cost-columns" aria-hidden="true"><span>费用名称（选填）</span><span>供应商</span><span>金额（元）</span><span></span></div>
                {#each product.extra_costs as extra, j (extra.line_id || j)}
                  <div class="extra-cost-row">
                    <input value={extra.name || ''} aria-label={`第 ${i + 1} 项额外成本名称 ${j + 1}`} placeholder="费用名称（选填，默认产品名）" oninput={(e) => desk.updateExtraCost(i, j, 'name', e.currentTarget.value)} />
                    <input value={extra.vendor || ''} aria-label={`第 ${i + 1} 项额外成本供应商 ${j + 1}`} placeholder="供应商" oninput={(e) => desk.updateExtraCost(i, j, 'vendor', e.currentTarget.value)} />
                    <input type="number" inputmode="decimal" min="0" step="0.01" value={extra.amount ?? ''} aria-label={`第 ${i + 1} 项额外成本金额 ${j + 1}`} placeholder="金额（元）" oninput={(e) => desk.updateExtraCost(i, j, 'amount', e.currentTarget.value)} />
                    <button type="button" class="delete-action" aria-label={`删除第 ${i + 1} 项的第 ${j + 1} 条额外成本`} title="删除额外成本" onclick={() => desk.removeExtraCost(i, j)}><Trash2 size={14} /></button>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {:else}<p class="empty-table">请添加至少一项产品</p>{/each}
    </div>
    <div class="form-grid"><label class="full">订单备注 / 交付说明<textarea bind:value={desk.note} placeholder="整单级说明：交付口径、来源或其他需要留痕的信息；单行说明请点每行右侧的备注图标填写"></textarea></label>
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
    <div class="form-footer"><span>至少添加一项产品；填写产品名称会自动匹配同名的报价和成本项；点产品行右侧的「+」可补充不匹配资料库的额外成本和供应商；勾选个人垫付的产品，订单保存后会按该行成本（含额外成本）自动生成当前录入人的报销记录。</span><div class="submit-dropdown"><button class="primary-action" disabled={desk.busy || desk.uploadingFiles || !desk.customerId}>{desk.busy || desk.uploadingFiles ? "保存中..." : "保存订单"}</button></div></div>
  </form>
</section>
