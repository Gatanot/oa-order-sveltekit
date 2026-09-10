<script lang="ts">
  import { getContext } from "svelte";
  import { Plus } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<section class="entry-layout">
  <form class="order-form" onsubmit={desk.submitOrder}>
    <div class="form-title">
      <div>
        <h3>订单信息</h3>
        <span>带 * 的字段为必填项</span>
      </div>
      <span class="form-step">STEP 1 / 1</span>
    </div>
    <div class="form-grid">
      <label
        >客户 <em>*</em><select
          bind:value={desk.customerId}
          onchange={desk.onCustomerChange}
          required
          ><option value="">请选择客户</option
          >{#each desk.customers as customer}<option value={customer.id}
              >{customer.name}</option
            >{/each}</select
        ></label
      ><label
        >项目 <em>*</em><select
          bind:value={desk.projectId}
          required
          disabled={!desk.customerId}
          ><option value=""
            >{desk.customerId ? "请选择项目" : "先选择客户"}</option
          >{#each desk.filteredProjects as project}<option value={project.id}
              >{project.name} · {project.owner || "未分配负责人"}</option
            >{/each}</select
        ></label
      >
      <div class="full inline-create">
        <span>没有找到对应项目？</span><button
          type="button"
          onclick={() => (desk.showProjectForm = true)}
          ><Plus size={14} />新建项目</button
        >
      </div>
      <label class="full order-content-field"
        >订单内容 <em>*</em><input
          bind:value={desk.serviceName}
          oninput={desk.onServiceInput}
          placeholder="直接输入订单内容，系统会实时推荐报价成本库条目"
          required
        /><small class="field-hint"
          >已选客户：{desk.selectedCustomer || "未选择"} · 已选项目：{desk.selectedProject ||
            "未选择"}</small
        >{#if desk.serviceName.trim() && desk.catalogSuggestions.length}<div
            class="catalog-suggestions"
          >
            <span>报价成本库推荐</span
            >{#each desk.catalogSuggestions as item}<button
                type="button"
                onclick={() => desk.applySuggestion(item)}
                ><b>{item.name}</b><small
                  >{item.category || "未分类"}{item.customer_name
                    ? ` · ${item.customer_name}`
                    : ""}{item.project_name
                    ? ` · ${item.project_name}`
                    : ""}</small
                ><strong
                  >{desk.money(item.quote_unit)} / {desk.money(item.cost_unit)} ·
                  {item.unit}</strong
                ></button
              >{/each}
          </div>{:else if desk.serviceName.trim()}<small class="field-hint"
            >没有匹配的库内条目，可继续手动填写。</small
          >{/if}</label
      ><label
        >数量 <input
          type="number"
          min="0.01"
          step="0.01"
          bind:value={desk.quantity}
          onchange={desk.onQuantityChange}
        /></label
      ><label
        >单位 <input bind:value={desk.unit} placeholder="项、套、人天" /></label
      ><label
        >单位报价（元） <em>*</em><input
          type="number"
          min="0"
          step="0.01"
          bind:value={desk.unitQuote}
          oninput={desk.syncTotals}
          placeholder="0.00"
          required
        /></label
      ><label
        >单位成本（元） <em>*</em><input
          type="number"
          min="0"
          step="0.01"
          bind:value={desk.unitCost}
          oninput={desk.syncTotals}
          placeholder="0.00"
          required
        /></label
      ><label>总报价（元） <input value={desk.quoteAmount} readonly /></label
      ><label>总成本（元） <input value={desk.costAmount} readonly /></label
      ><label class="full"
        >规格和技术要求 <textarea
          bind:value={desk.specification}
          placeholder="选择报价成本库后自动填充，也可以留空"
        ></textarea></label
      ><label
        >报价成本库 <span class="optional-mark">输入订单内容后自动推荐</span
        ><select bind:value={desk.catalogId} onchange={desk.applyCatalog}
          ><option value="">不使用推荐条目</option
          >{#each desk.catalog as item}<option value={item.id}
              >{item.category ? `${item.category} / ` : ""}{item.name} · 报价
              {desk.money(item.quote_unit)} / {item.unit}</option
            >{/each}</select
        ></label
      ><label>订单日期 <input type="date" bind:value={desk.orderDate} /></label
      ><label
        >录入人 <input
          bind:value={desk.createdBy}
          placeholder={desk.creatorName || "请设置或填写名字"}
        /><small class="field-hint"
          >{desk.creatorName
            ? "已自动填入浏览器中保存的名字，可按本单修改。"
            : "可在左下角“设置填写人”中保存常用名字。"}</small
        ></label
      ><label class="full"
        >备注 <textarea
          bind:value={desk.note}
          placeholder="补充交付说明、来源或其他需要留痕的信息"
        ></textarea><small class="field-hint"
          >未选择报价成本库的订单会进入报销核验。</small
        ></label
      ><label class="full upload-desk.note-field"
        ><span
          >备注附件 <small class="optional-mark">空实现，仅保存文件元数据</small
          ></span
        ><input
          type="file"
          multiple
          onchange={(event) => {
            desk.noteFiles = [
              ...((event.currentTarget as HTMLInputElement).files || []),
            ];
          }}
        /><small class="field-hint"
          >{desk.noteFiles.length
            ? `已选择 ${desk.noteFiles.length} 个文件：${desk.noteFiles.map((file: File) => file.name).join("、")}`
            : "可选择发票、付款截图等文件，当前不会上传文件内容。"}</small
        ></label
      >
    </div>
    <div class="form-footer">
      <span>提交报销的订单会在订单总览标记“需报销”，并同步到报销核验。</span>
      <div class="submit-dropdown" class:open={desk.submitMenuOpen}>
        <div class="submit-group">
          <button
            type="submit"
            class="primary-action"
            disabled={desk.busy || !desk.projectId}
            >{desk.busy
              ? "保存中..."
              : desk.submitMode === "reimburse"
                ? "提交报销"
                : "保存订单"}</button
          ><button
            type="button"
            class="submit-caret"
            aria-label="选择订单提交方式"
            aria-haspopup="menu"
            aria-expanded={desk.submitMenuOpen}
            onclick={(event) => {
              event.stopPropagation();
              desk.submitMenuOpen = !desk.submitMenuOpen;
            }}><span></span></button
          >
        </div>
        {#if desk.submitMenuOpen}<div class="submit-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onclick={() => {
                desk.submitMode = "save";
                desk.closeSubmitMenu();
              }}>保存订单</button
            ><button
              type="button"
              role="menuitem"
              onclick={() => {
                desk.submitMode = "reimburse";
                desk.closeSubmitMenu();
              }}>提交报销</button
            >
          </div>{/if}
      </div>
    </div>
  </form>
</section>
