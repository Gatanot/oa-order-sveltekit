<script lang="ts">
  import { getContext } from "svelte";
  import { FileSpreadsheet, Search, Upload } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<section class="page-section">
  <div class="section-heading">
    <div>
      <p class="section-kicker">REFERENCE DATA</p>
      <h2>报价 / 成本库</h2>
      <span>查看已导入的报价和成本条目，也可在录入订单时实时匹配推荐</span>
    </div>
    <label class="upload-action"
      ><Upload size={16} />导入 Excel<input
        type="file"
        accept=".xlsx,.xls,.csv"
        onchange={desk.importFile}
      /></label
    >
  </div>
  <div class="catalog-guide">
    <FileSpreadsheet size={18} /><span
      >支持 Excel 或 CSV。导入后内容会保存在报价 /
      成本库中，可按名称、分类、客户或项目查看。</span
    >
  </div>
  <div class="catalog-filters">
    <label class="search-field"
      ><Search size={16} /><input
        bind:value={desk.catalogSearch}
        placeholder="搜索名称、分类、客户或项目"
      /></label
    ><select bind:value={desk.catalogCategory}
      ><option value="">全部分类</option
      >{#each desk.catalogCategories as category}<option value={category}
          >{category}</option
        >{/each}</select
    ><span>共 {desk.visibleCatalog.length} 条</span>
  </div>
  <div class="table-panel">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>分类</th><th>服务名称</th><th>适用客户</th><th>适用项目</th><th
              >单位</th
            ><th>报价单价</th><th>成本单价</th><th>预估毛利</th></tr
          ></thead
        ><tbody
          >{#each desk.visibleCatalog as item}<tr
              ><td
                ><span class="category-label">{item.category || "未分类"}</span
                ></td
              ><td><b>{item.name}</b></td><td>{item.customer_name || "通用"}</td
              ><td>{item.project_name || "通用"}</td><td>{item.unit}</td><td
                class="money">{desk.money(item.quote_unit)}</td
              ><td class="money cost">{desk.money(item.cost_unit)}</td><td
                class="money positive"
                >{desk.money(item.quote_unit - item.cost_unit)}</td
              ></tr
            >{:else}<tr
              ><td colspan="8"
                ><div class="empty-table">
                  报价成本库为空，请导入 Excel。
                </div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
</section>
