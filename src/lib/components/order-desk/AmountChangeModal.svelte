<script lang="ts">
  import { getContext } from 'svelte';
  import { appPath } from '$lib/api';
  import { CircleAlert, PencilLine, X } from 'lucide-svelte';

  const desk = getContext<any>('order-desk');
  let { item, onclose, onchanged }: { item: any; onclose: () => void; onchanged: () => void } = $props();

  let amount = $state((Number(item.advance_amount || 0) / 100).toFixed(2));
  let reason = $state('');
  let submitting = $state(false);
  let error = $state('');
  let reasonInput = $state<HTMLTextAreaElement>();

  const reviewStageLabels: Record<string, string> = {
    '待一级审核': '一级审核',
    '待二级审核': '二级审核',
    '待三级审核': '三级审核',
    '待执行': '待执行'
  };
  const rollbackLabels: Record<string, string> = {
    '待二级审核': '一级审核',
    '待三级审核': '二级审核',
    '待执行': '三级审核'
  };
  const rollbackLabel = $derived(rollbackLabels[item.reimbursement_status] || '');
  const currentStage = $derived(reviewStageLabels[item.reimbursement_status] || '');
  const isUnderReview = $derived(Boolean(currentStage));
  const unchanged = $derived(Math.round(Number(amount || 0) * 100) === Number(item.advance_amount || 0));

  async function submitChange() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      error = '请输入大于 0 的报销金额';
      return;
    }
    if (!reason.trim()) {
      error = '请填写修改金额的原因';
      return;
    }
    submitting = true;
    error = '';
    try {
      const response = await fetch(appPath(`/api/reimbursements/${encodeURIComponent(item.id)}/amount-change`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, reason: reason.trim() })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.detail || payload.message || '修改金额失败');
      await desk.refresh();
      desk.notify(rollbackLabel ? `金额已修改，报销已退回${rollbackLabel}重新审核` : isUnderReview ? '金额已修改，审核人将看到修改记录' : '金额已修改，并已标记为内容有修改');
      onchanged();
    } catch (reasonValue) {
      error = reasonValue instanceof Error ? reasonValue.message : '修改金额失败';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !submitting) onclose(); }}>
  <div class="project-modal amount-change-modal" role="dialog" aria-modal="true" aria-labelledby="amount-change-title">
    <div class="project-modal-head">
      <div>
        <p class="section-kicker">我的报销 · 修改内容</p>
        <h2 id="amount-change-title">申请修改报销金额</h2>
        <span>{item.code || '订单'} · {item.advance_item || item.item}</span>
      </div>
      <button class="icon-control" type="button" aria-label="关闭修改金额窗口" disabled={submitting} onclick={onclose}><X size={18} /></button>
    </div>
    <form onsubmit={(event) => { event.preventDefault(); submitChange(); }}>
      <div class="project-modal-body">
        <div class="amount-change-summary">
          <div><small>当前金额</small><b>{desk.money(item.advance_amount)}</b></div>
          <div><small>当前状态</small><b>{item.reimbursement_status}</b></div>
        </div>
        <label class="full-field">新的报销金额（元） <em>*</em><input type="number" inputmode="decimal" min="0.01" step="0.01" bind:value={amount} required /></label>
        <label class="full-field">修改原因 <em>*</em><textarea bind:this={reasonInput} bind:value={reason} placeholder="请说明实际支付金额与订单成本不一致的原因" required></textarea></label>
        {#if rollbackLabel}
          <p class="amount-change-warning"><CircleAlert size={16} /><span>该报销已通过部分审核，修改金额后将自动退回【{rollbackLabel}】重新审核，并在列表标记为“已修改”。</span></p>
        {:else if currentStage}
          <p class="amount-change-warning"><CircleAlert size={16} /><span>该报销正在【{currentStage}】，修改后会标记为“已修改”，由当前审核节点按新金额继续审核。</span></p>
        {:else}
          <p class="amount-change-note"><PencilLine size={16} /><span>修改只影响报销金额，不会改动订单成本；提交后会标记为“已修改”，审核人可查看修改原因。</span></p>
        {/if}
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
      </div>
      <div class="project-modal-footer">
        <span>{rollbackLabel ? `提交后退回${rollbackLabel}重新审核` : currentStage ? '提交后当前审核节点按新金额审核' : '提交后记录修改原因，等待报销提交'}</span>
        <button class="outline-action" type="button" disabled={submitting} onclick={onclose}>取消</button>
        <button class="primary-action" type="submit" disabled={submitting || unchanged || !reason.trim()}>{submitting ? '提交中...' : '提交修改'}</button>
      </div>
    </form>
  </div>
</div>
