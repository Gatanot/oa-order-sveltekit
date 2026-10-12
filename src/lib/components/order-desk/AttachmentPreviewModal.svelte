<script lang="ts">
  import { Download, ExternalLink, FileQuestion, LoaderCircle, X } from 'lucide-svelte';
  import { getContext } from 'svelte';
  import { appBaseUrl } from '$lib/api';

  const desk = getContext<any>('order-desk');
  const isPdf = () => desk.attachmentPreviewMime === 'application/pdf' || desk.attachmentPreviewName.toLowerCase().endsWith('.pdf');
  const isImage = () => desk.attachmentPreviewMime.startsWith('image/');

  let pdfContainer = $state<HTMLDivElement | undefined>();
  let pdfError = $state('');
  let pdfRendering = $state(false);
  let pdfPageCount = $state(0);
  let pdfRenderedPages = $state(0);
  let renderToken = 0;
  let pdfDocument: any = null;

  function openInNewWindow() {
    if (!desk.attachmentPreviewUrl) return;
    window.open(desk.attachmentPreviewUrl, '_blank', 'noopener,noreferrer');
  }

  function resetPdfView() {
    renderToken++;
    if (pdfDocument) {
      try { pdfDocument.destroy(); } catch { /* 已销毁 */ }
      pdfDocument = null;
    }
    pdfError = '';
    pdfRendering = false;
    pdfPageCount = 0;
    pdfRenderedPages = 0;
    if (pdfContainer) pdfContainer.replaceChildren();
  }

  // PDF 预览不再依赖 <iframe>：网关注入的 CSP 未声明 frame-src，会回退到 default-src 'none'，
  // 导致任何 iframe 都被拦截。这里改为用 pdf.js 把页面绘制到 canvas，绕开 frame-src / object-src。
  async function renderPdf(blob: Blob) {
    resetPdfView();
    const token = renderToken;
    pdfRendering = true;
    try {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const data = await blob.arrayBuffer();
      if (token !== renderToken) return;
      const doc = await pdfjs.getDocument({
        data,
        cMapUrl: `${appBaseUrl()}pdfjs/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${appBaseUrl()}pdfjs/standard_fonts/`,
        useSystemFonts: true
      }).promise;
      if (token !== renderToken) { doc.destroy(); return; }
      pdfDocument = doc;
      pdfPageCount = doc.numPages;
      if (!pdfContainer) return;
      const containerWidth = Math.max(pdfContainer.clientWidth, 320);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (token !== renderToken) return;
        const page = await doc.getPage(pageNumber);
        if (token !== renderToken) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(containerWidth / baseViewport.width, 2) * dpr;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.className = 'attachment-preview-page';
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建画布上下文');
        pdfContainer.appendChild(canvas);
        await page.render({ canvasContext: context, viewport }).promise;
        if (token !== renderToken) return;
        pdfRenderedPages = pageNumber;
      }
    } catch (reason) {
      if (token !== renderToken) return;
      pdfError = reason instanceof Error ? reason.message : 'PDF 渲染失败';
    } finally {
      if (token === renderToken) pdfRendering = false;
    }
  }

  $effect(() => {
    const open = desk.attachmentPreviewOpen;
    const blob = desk.attachmentPreviewBlob;
    if (open && blob && isPdf()) {
      void renderPdf(blob);
      return () => {
        renderToken++;
        if (pdfDocument) {
          try { pdfDocument.destroy(); } catch { /* 已销毁 */ }
          pdfDocument = null;
        }
      };
    }
    resetPdfView();
  });
</script>

{#if desk.attachmentPreviewOpen}
  <div class="attachment-preview-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) desk.closeAttachmentPreview(); }}>
    <div class="attachment-preview-modal" role="dialog" aria-modal="true" aria-labelledby="attachment-preview-title" tabindex="-1">
      <header class="attachment-preview-head">
        <div><p class="section-kicker">附件预览</p><h2 id="attachment-preview-title">{desk.attachmentPreviewName || '附件预览'}</h2><span>{isPdf() ? 'PDF 文件' : isImage() ? '图片文件' : desk.attachmentPreviewMime || '附件文件'}</span></div>
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
          {#if pdfError}
            <div class="attachment-preview-state preview-error"><FileQuestion size={34} /><b>无法预览 PDF</b><span>{pdfError}</span><span>可以下载文件后使用本地应用打开。</span></div>
          {:else}
            <div class="attachment-preview-pdf" bind:this={pdfContainer}></div>
            {#if !pdfPageCount}
              <div class="attachment-preview-state"><LoaderCircle class="preview-spinner" size={30} /><b>正在渲染 PDF</b><span>文件较大时可能需要等待几秒</span></div>
            {/if}
          {/if}
        {:else if desk.attachmentPreviewUrl}
          <div class="attachment-preview-state"><FileQuestion size={34} /><b>该文件类型暂不支持在线预览</b><span>可以下载文件后使用本地应用打开。</span></div>
        {/if}
        {#if isPdf() && !desk.attachmentPreviewError && !pdfError && pdfPageCount > 0 && pdfRendering}
          <div class="attachment-preview-progress">正在渲染 {pdfRenderedPages} / {pdfPageCount} 页</div>
        {/if}
      </div>

      <footer class="attachment-preview-footer">
        <span>预览内容来自当前系统保存的附件</span>
        <div>
          {#if desk.attachmentPreviewUrl}{#if !(isPdf() && desk.onArtifactGateway)}<button class="outline-action" type="button" onclick={openInNewWindow}><ExternalLink size={16} />新窗口打开</button>{/if}<a class="primary-action" href={desk.attachmentPreviewUrl} download={desk.attachmentPreviewName}><Download size={16} />下载附件</a>{/if}
          <button class="outline-action" type="button" onclick={desk.closeAttachmentPreview}>关闭</button>
        </div>
      </footer>
    </div>
  </div>
{/if}
