<script lang="ts">
  import { page } from "$app/state";
</script>

<svelte:head><title>页面错误 · ORBIT OA</title></svelte:head>
<main class="error-page">
  <strong>{page.status}</strong>
  <h1>页面暂时无法显示</h1>
  <p>{page.error?.message ?? "请稍后再试"}</p>
  <a href="./orders">返回工作台</a>
</main>

<style>
  .error-page {
    min-height: 100vh;
    display: grid;
    place-content: center;
    text-align: center;
    font-family: Inter, "PingFang SC", sans-serif;
    background: #f4f6f8;
    color: #17202b;
  }
  .error-page strong {
    font-size: 64px;
    color: #168b88;
  }
  .error-page h1 {
    margin: 8px;
  }
  .error-page p {
    color: #71808f;
  }
  .error-page a {
    color: #168b88;
  }
</style>
