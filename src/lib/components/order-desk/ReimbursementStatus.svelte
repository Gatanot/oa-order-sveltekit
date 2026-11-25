<script lang="ts">
  let { status = '待审核', compact = false }: { status?: string; compact?: boolean } = $props();
  const labels: Record<string, string> = {
    '待一级审核': '一级审核', '待二级审核': '二级审核',
    '待三级审核': '三级审核', '待执行': '待执行',
  };
  /* 每个节点使用主题中已有的语义色，避免三级审核全部显示成同一种黄色。 */
  const tones: Record<string, string> = {
    '待一级审核': 'review',
    '待二级审核': 'recheck',
    '待三级审核': 'confirm',
    '待执行': 'payment',
    '已执行': 'paid',
    '已打回': 'rejected'
  };
  const tone = $derived(tones[status] || 'pending');
</script>

<span class={`status-dot reimbursement-status reimbursement-${tone}`} title={status}>{compact ? labels[status] || status : status}</span>
