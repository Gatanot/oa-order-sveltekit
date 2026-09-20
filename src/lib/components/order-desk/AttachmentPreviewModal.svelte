<script lang="ts">
  import { Download, ExternalLink, FileQuestion, LoaderCircle, X } from 'lucide-svelte';
  import { getContext } from 'svelte';

  const desk = getContext<any>('order-desk');
  const isPdf = () => desk.attachmentPreviewMime === 'application/pdf' || desk.attachmentPreviewName.toLowerCase().endsWith('.pdf');
  const isImage = () => desk.attachmentPreviewMime.startsWith('image/');

  function openInNewWindow() {
    if (!desk.attachmentPreviewUrl) return;
    window.open(desk.attachmentPreviewUrl, '_blank', 'noopener,noreferrer');
  }
</script>

{#if desk.attachmentPreviewOpen}
  <div class="attachment-preview-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.closeAttachmentPreview(); }}>
    <div class="attachment-preview-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title" tabindex="-1">
      <header class="attachment-preview-head">
        <div><p class="section-kicker">ATTACHMENT PREVIEW</p><h2 id="attachment-preview-title">{desk.attachmentPreviewName || '附件预览'}</h2><span>{isPdf() ? 'PDF 文件' : isImage() ? '图片文件' : desk.attachmentPreviewMime || '附件文件'}</span></div>
        <button class="icon-control" type="button" aria-label="关闭附件预览" onclick={desk.closeAttachmentPreview}><X size={18} /></button>
      </header>

      <div class:preview-loading={desk.attachmentPreviewLoading} class="attachment-preview-body">
        {#if desk.attachmentPreviewLoading}
          <div class="attachment-preview-state"><LoaderCircle class="preview-spinner" size={30} /><b>正在加载附件</b><span>文件较大时可能需要等待几秒</span></div>
        {:else if desk.attachmentPreviewError}
          <div class="attachment-preview-state preview-error"><FileQuestion size={34} /><b>无法预览附件</b><span>{desk.attachmentPreviewError}</span></div>
        {:else if desk.attachmentPreviewUrl && isImage()}
          <img class="attachment-preview-image" src={desk.attachmentPreviewUrl} alt={desk.attachmentPreviewName} />
        {:else if desk.attachmentPreviewUrl && isPdf()}
          <iframe class="attachment-preview-frame" src={desk.attachmentPreviewUrl} title={`预览 ${desk.attachmentPreviewName}`}></iframe>
        {:else if desk.attachmentPreviewUrl}
          <div class="attachment-preview-state"><FileQuestion size={34} /><b>该文件类型暂不支持在线预览</b><span>可以下载文件后使用本地应用打开。</span></div>
        {/if}
      </div>

      <footer class="attachment-preview-footer">
        <span>预览内容来自当前系统保存的附件</span>
        <div>
          {#if desk.attachmentPreviewUrl}<button class="outline-action" type="button" onclick={openInNewWindow}><ExternalLink size={16} />新窗口打开</button><a class="primary-action" href={desk.attachmentPreviewUrl} download={desk.attachmentPreviewName}><Download size={16} />下载附件</a>{/if}
          <button class="outline-action" type="button" onclick={desk.closeAttachmentPreview}>关闭</button>
        </div>
      </footer>
    </div>
  </div>
{/if}
