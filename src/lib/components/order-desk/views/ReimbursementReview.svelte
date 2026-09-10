<script lang="ts">
  import { getContext } from "svelte";
  import { Paperclip } from "lucide-svelte";
  const desk = getContext<any>("order-desk");
</script>

<section class="page-section">
  <div class="section-heading">
    <div>
      <p class="section-kicker">FINANCE REVIEW</p>
      <h2>员工垫付 / 报销核验</h2>
      <span
        >未选择报价成本库的订单默认进入这里，按项目、日期和录入人员核验。</span
      >
    </div>
  </div>
  <div class="filter-bar">
    <select bind:value={desk.reimbursementProject}
      ><option value="">全部项目</option>{#each desk.projects as project}<option
          value={project.id}>{project.name}</option
        >{/each}</select
    ><select bind:value={desk.reimbursementPerson}
      ><option value="">全部人员</option>{#each desk.creators as person}<option
          value={person}>{person}</option
        >{/each}</select
    ><select bind:value={desk.reimbursementStatus}
      ><option value="">全部状态</option><option value="待核验">待核验</option
      ><option value="待报销">待报销</option><option value="已报销"
        >已报销</option
      ></select
    ><label class="date-field"
      ><span>从</span><input
        type="date"
        bind:value={desk.reimbursementFrom}
      /></label
    ><label class="date-field"
      ><span>至</span><input
        type="date"
        bind:value={desk.reimbursementTo}
      /></label
    >
  </div>
  <div class="table-panel">
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>订单</th><th>项目 / 人员</th><th>日期</th><th>订单内容</th><th
              >金额</th
            ><th>备注附件</th><th>报销状态</th><th>操作</th></tr
          ></thead
        ><tbody
          >{#each desk.reimbursements.filter((item: any) => (!desk.reimbursementProject || item.project_id === desk.reimbursementProject) && (!desk.reimbursementPerson || item.created_by === desk.reimbursementPerson) && (!desk.reimbursementStatus || item.reimbursement_status === desk.reimbursementStatus) && (!desk.reimbursementFrom || item.order_date >= desk.reimbursementFrom) && (!desk.reimbursementTo || item.order_date <= desk.reimbursementTo)) as item}<tr
              ><td><b>{item.code}</b></td><td
                ><b>{item.project_name}</b><small>{item.created_by}</small></td
              ><td>{item.order_date}</td><td>{item.service_name}</td><td
                class="money">{desk.money(item.cost_amount)}</td
              ><td
                ><Paperclip size={14} />
                {item.attachment_count
                  ? `${item.attachment_count} 个`
                  : "未上传"}</td
              ><td
                ><span class="status-dot">{item.reimbursement_status}</span></td
              ><td
                >{#if item.reimbursement_status === "待核验"}<button
                    class="primary-action"
                    onclick={() => desk.markReimbursement(item, "待报销")}
                    >确认待报销</button
                  >{:else if item.reimbursement_status === "待报销"}<button
                    class="primary-action"
                    onclick={() => desk.markReimbursement(item, "已报销")}
                    >标记已报销</button
                  >{:else}<span class="muted">已完成</span>{/if}</td
              ></tr
            >{:else}<tr
              ><td colspan="8"
                ><div class="empty-table">暂无需要报销核验的订单。</div></td
              ></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </div>
</section>
