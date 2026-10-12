<script lang="ts">
  let { status = '待审核', compact = false }: { status?: string; compact?: boolean } = $props();
  const labels: Record<string, string> = {
    '已提交待审核': '待审核', '已审核待复核': '待复核',
    '已复核待确认': '待确认', '已确认待执行': '待执行',
  };
  const tone = $derived(status === '已执行' ? 'paid' : status === '已打回' ? 'rejected' : 'pending');
</script>

<span class={`status-dot reimbursement-status reimbursement-${tone}`} title={status}>{compact ? labels[status] || status : status}</span>
