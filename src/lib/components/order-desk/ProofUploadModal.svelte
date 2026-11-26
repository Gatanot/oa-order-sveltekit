<script lang="ts">
  import { getContext } from 'svelte';
  import { appPath } from '$lib/api';
  import { CheckCircle2, FileText, Image, Paperclip, Upload, X } from 'lucide-svelte';

  const desk = getContext<any>('order-desk');
  let { item, onclose, onsubmitted }: { item: any; onclose: () => void; onsubmitted: () => void } = $props();

  let attachments = $state<Array<any>>([]);
  let loading = $state(true);
  let uploadingKind = $state('');
  let submitting = $state(false);
  let error = $state('');
  let proofInput = $state<HTMLInputElement>();
  let invoiceInput = $state<HTMLInputElement>();

  const proofFiles = $derived(attachments.filter((file) => file.attachment_kind === 'proof'));
  const invoiceFiles = $derived(attachments.filter((file) => file.attachment_kind !== 'proof'));
  const hasProof = $derived(proofFiles.length > 0);
  const hasInvoice = $derived(invoiceFiles.length > 0);
  const canSubmit = $derived(hasProof && hasInvoice && !loading && !uploadingKind && !submitting && !desk.busy);

  async function loadAttachments() {
    loading = true;
    error = '';
    try {
      const response = await fetch(appPath(`/api/reimbursements/${encodeURIComponent(item.id)}/attachments`));
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.message || '附件加载失败');
      attachments = payload.data || [];
    } catch (reason) {
      error = reason instanceof Error ? reason.message : '附件加载失败';
    } finally {
      loading = false;
    }
  }

  function openPicker(kind: 'proof' | 'invoice') {
    if (kind === 'proof') proofInput?.click();
    else invoiceInput?.click();
  }

  async function onFileChange(kind: 'proof' | 'invoice', event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) && file.type !== 'application/pdf') {
      error = '仅支持图片（PNG/JPG/GIF/WebP）或 PDF 文件';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      error = '单个文件不能超过 10MB';
      return;
    }
    uploadingKind = kind;
    error = '';
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      form.append('kind', kind);
      const response = await fetch(appPath(`/api/reimbursements/${encodeURIComponent(item.id)}/attachments`), {
        method: 'POST',
        headers: { 'X-OA-Request': '1' },
        body: form
      });
      const text = await response.text();
      let payload: any = {};
      try { payload = text ? JSON.parse(text) : {}; } catch { /* 非 JSON 错误响应 */ }
      if (!response.ok) throw new Error(payload.error?.message || payload.message || text || `上传失败（HTTP ${response.status}）`);
      await loadAttachments();
      desk.notify(kind === 'proof' ? '付款截图已上传' : '发票已上传');
    } catch (reason) {
      error = reason instanceof Error ? reason.message : '上传失败';
    } finally {
      uploadingKind = '';
    }
  }

  async function submitProof() {
    if (!hasProof || !hasInvoice) {
      error = '请同时上传付款截图和发票后再提交';
      return;
    }
    submitting = true;
    error = '';
    try {
      const response = await fetch(appPath(`/api/reimbursements/${encodeURIComponent(item.id)}/submit-proof`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.detail || payload.message || '提交失败');
      desk.notify('付款截图和发票已提交，等待一级审核');
      await desk.refresh();
      onsubmitted();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : '提交失败';
    } finally {
      submitting = false;
    }
  }

  $effect(() => { void loadAttachments(); });
</script>

<div class="project-modal-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget && !submitting) onclose(); }}>
  <div class="project-modal proof-upload-modal" role="dialog" aria-modal="true" aria-labelledby="proof-upload-title">
    <div class="project-modal-head">
      <div>
        <p class="section-kicker">我的报销 · 待上传证明</p>
        <h2 id="proof-upload-title">上传付款截图与发票</h2>
        <span>{item.code || '订单'} · {item.project_name || '内务报销'} · {item.advance_item || item.item}</span>
      </div>
      <button class="icon-control" type="button" aria-label="关闭上传证明窗口" disabled={submitting} onclick={onclose}><X size={18} /></button>
    </div>
    <div class="project-modal-body">
      <div class="proof-summary">
        <div><small>报销金额</small><b>{desk.money(item.advance_amount)}</b></div>
        <div><small>垫付日期</small><b>{item.advance_date}</b></div>
        <div><small>报销人</small><b>{item.employee}</b></div>
      </div>
      <p class="field-hint proof-upload-hint">请上传实际付款截图和对应发票（图片或 PDF，单个不超过 10MB），两项齐全后点击【提交】进入审批流程。</p>
      {#if error}<p class="form-error" role="alert">{error}</p>{/if}
      <div class="proof-upload-grid">
        <section class="proof-slot" class:complete={hasProof}>
          <header>
            <span class="proof-slot-icon"><Image size={17} /></span>
            <div><b>付款截图 <em>*</em></b><small>{hasProof ? '已上传' : '待上传'}</small></div>
            {#if hasProof}<CheckCircle2 size={18} class="proof-check" />{/if}
          </header>
          <input class="visually-hidden" bind:this={proofInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" onchange={(event) => onFileChange('proof', event)} />
          <button class="outline-action proof-upload-action" type="button" disabled={Boolean(uploadingKind) || submitting} onclick={() => openPicker('proof')}>
            <Upload size={15} />{uploadingKind === 'proof' ? '上传中...' : hasProof ? '重新上传付款截图' : '选择付款截图'}
          </button>
          {#if proofFiles.length}
            <ul class="proof-file-list">{#each proofFiles as file}<li><button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}><Paperclip size={13} /><span>{file.file_name}</span><small>{desk.formatFileSize(file.file_size)}</small></button></li>{/each}</ul>
          {:else}
            <small class="proof-empty">尚未上传付款截图</small>
          {/if}
        </section>
        <section class="proof-slot" class:complete={hasInvoice}>
          <header>
            <span class="proof-slot-icon"><FileText size={17} /></span>
            <div><b>发票 <em>*</em></b><small>{hasInvoice ? '已上传' : '待上传'}</small></div>
            {#if hasInvoice}<CheckCircle2 size={18} class="proof-check" />{/if}
          </header>
          <input class="visually-hidden" bind:this={invoiceInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" onchange={(event) => onFileChange('invoice', event)} />
          <button class="outline-action proof-upload-action" type="button" disabled={Boolean(uploadingKind) || submitting} onclick={() => openPicker('invoice')}>
            <Upload size={15} />{uploadingKind === 'invoice' ? '上传中...' : hasInvoice ? '重新上传发票' : '选择发票'}
          </button>
          {#if invoiceFiles.length}
            <ul class="proof-file-list">{#each invoiceFiles as file}<li><button class="attachment-link" type="button" onclick={() => desk.openAttachmentPreview(desk.reimbursementAttachmentUrl(file.id), file.file_name, file.mime_type)}><Paperclip size={13} /><span>{file.file_name}</span><small>{desk.formatFileSize(file.file_size)}</small></button></li>{/each}</ul>
          {:else}
            <small class="proof-empty">尚未上传发票</small>
          {/if}
        </section>
      </div>
      {#if loading}<p class="field-hint">正在加载已上传附件...</p>{/if}
    </div>
    <div class="project-modal-footer">
      <span>{hasProof && hasInvoice ? '付款截图和发票已齐全，可提交审核。' : '付款截图和发票都上传后才能提交。'}</span>
      <button class="outline-action" type="button" disabled={submitting} onclick={onclose}>取消</button>
      <button class="primary-action" type="button" disabled={!canSubmit} onclick={submitProof}>
        {submitting ? '提交中...' : '提交'}
      </button>
    </div>
  </div>
</div>
