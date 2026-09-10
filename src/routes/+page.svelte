<script lang="ts">
  import {
    Download,
    FileSpreadsheet,
    LayoutDashboard,
    ListFilter,
    Menu,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    Upload,
    X,
    WalletCards,
    Paperclip,
    Settings,
  } from "lucide-svelte";
  import * as XLSX from "xlsx";
  import { onMount } from "svelte";
  import { api } from "$lib/api";

  type Customer = { id: string; name: string; contact: string };
  type Project = {
    id: string;
    customer_id: string;
    customer_name: string;
    name: string;
    owner: string;
    status: string;
  };
  type Catalog = {
    id: string;
    category: string;
    name: string;
    unit: string;
    quote_unit: number;
    cost_unit: number;
    specification?: string;
    customer_name?: string;
    project_name?: string;
  };
  type Order = {
    id: string;
    code: string;
    customer_id: string;
    project_id: string;
    customer_name: string;
    project_name: string;
    project_owner: string;
    service_name: string;
    specification?: string;
    quantity: number;
    unit: string;
    quote_amount: number;
    cost_amount: number;
    order_date: string;
    created_by: string;
    status: string;
    reimbursement_status?: string;
    note: string;
  };
  type Reimbursement = Order & {
    reimbursement_status: string;
    attachment_count: number;
  };
  type Data = {
    customers: Customer[];
    projects: Project[];
    catalog: Catalog[];
    orders: Order[];
    reimbursements: Reimbursement[];
  };
  let { data }: { data: Data } = $props();
  let view = $state<"overview" | "entry" | "catalog" | "finance">("overview");
  let sidebarCollapsed = $state(false);
  let customers = $state(data.customers);
  let projects = $state(data.projects);
  let catalog = $state(data.catalog);
  let orders = $state(data.orders);
  let reimbursements = $state(data.reimbursements);
  let customerId = $state("");
  let projectId = $state("");
  let catalogId = $state("");
  let serviceName = $state("");
  let quantity = $state(1);
  let unit = $state("项");
  let unitQuote = $state("");
  let unitCost = $state("");
  let quoteAmount = $state("");
  let costAmount = $state("");
  let specification = $state("");
  let orderDate = $state(new Date().toISOString().slice(0, 10));
  let createdBy = $state("");
  let note = $state("");
  let noteFiles = $state<File[]>([]);
  const creatorNameStorageKey = "orbit-oa-creator-name";
  let creatorName = $state("");
  let creatorNameDraft = $state("");
  let settingsOpen = $state(false);
  let newCustomer = $state("");
  let newProject = $state("");
  let newOwner = $state("");
  let showProjectForm = $state(false);
  let busy = $state(false);
  let message = $state("");
  let error = $state("");
  let reimbursementProject = $state("");
  let reimbursementPerson = $state("");
  let reimbursementStatus = $state("");
  let reimbursementFrom = $state("");
  let reimbursementTo = $state("");
  let search = $state("");
  let catalogSearch = $state("");
  let catalogCategory = $state("");
  let filterCustomer = $state("");
  let filterProject = $state("");
  let filterOwner = $state("");
  let filterCreator = $state("");
  let filterFrom = $state("");
  let filterTo = $state("");
  let submitMode = $state<"save" | "reimburse">("save");
  let submitMenuOpen = $state(false);
  let showExport = $state(false);
  let selectedOrderIds = $state<string[]>([]);
  let selectedColumns = $state([
    "code",
    "order_date",
    "customer_name",
    "project_name",
    "project_owner",
    "service_name",
    "quantity",
    "quote_amount",
    "cost_amount",
    "created_by",
  ]);
  const exportColumns = [
    ["code", "订单编号"],
    ["order_date", "订单日期"],
    ["customer_name", "客户"],
    ["project_name", "项目"],
    ["project_owner", "项目负责人"],
    ["service_name", "订单内容"],
    ["quantity", "数量"],
    ["unit", "单位"],
    ["quote_amount", "总报价"],
    ["cost_amount", "总成本"],
    ["created_by", "录入人"],
    ["status", "状态"],
    ["note", "备注"],
    ["reimbursement_status", "报销状态"],
  ];
  const money = (c: number) =>
    `¥${(c / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;
  const filteredProjects = $derived(
    projects.filter((p) => !customerId || p.customer_id === customerId),
  );
  const visibleCatalog = $derived(
    catalog.filter(
      (item) =>
        (!catalogSearch ||
          `${item.name} ${item.category} ${item.customer_name || ""} ${item.project_name || ""}`
            .toLowerCase()
            .includes(catalogSearch.toLowerCase())) &&
        (!catalogCategory || item.category === catalogCategory),
    ),
  );
  const catalogCategories = $derived([
    ...new Set(catalog.map((item) => item.category).filter(Boolean)),
  ]);
  const selectedCatalog = $derived(
    catalog.find((item) => item.id === catalogId),
  );
  const selectedCustomer = $derived(
    customers.find((item) => item.id === customerId)?.name || "",
  );
  const selectedProject = $derived(
    projects.find((item) => item.id === projectId)?.name || "",
  );
  const catalogSuggestions = $derived(
    catalog
      .filter((item) => {
        const keyword = serviceName.trim().toLowerCase();
        const text = `${item.name} ${item.category}`.toLowerCase();
        const keywordMatch = !keyword || text.includes(keyword);
        const customerMatch =
          !item.customer_name || item.customer_name === selectedCustomer;
        const projectMatch =
          !item.project_name || item.project_name === selectedProject;
        return keywordMatch && customerMatch && projectMatch;
      })
      .slice(0, 8),
  );
  const filteredOrders = $derived(
    orders.filter(
      (o) =>
        (!search ||
          `${o.code}${o.customer_name}${o.project_name}${o.service_name}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!filterCustomer || o.customer_id === filterCustomer) &&
        (!filterProject || o.project_id === filterProject) &&
        (!filterOwner || o.project_owner === filterOwner) &&
        (!filterCreator || o.created_by === filterCreator) &&
        (!filterFrom || o.order_date >= filterFrom) &&
        (!filterTo || o.order_date <= filterTo),
    ),
  );
  const projectStats = $derived(
    projects
      .map((project) => {
        const items = orders.filter((order) => order.project_id === project.id);
        return {
          ...project,
          orderCount: items.length,
          quote: items.reduce((sum, item) => sum + item.quote_amount, 0),
          cost: items.reduce((sum, item) => sum + item.cost_amount, 0),
        };
      })
      .filter((project) => project.orderCount > 0),
  );
  const allFilteredSelected = $derived(
    filteredOrders.length > 0 &&
      filteredOrders.every((order) => selectedOrderIds.includes(order.id)),
  );
  const totalQuote = $derived(
    filteredOrders.reduce((sum, item) => sum + item.quote_amount, 0),
  );
  const totalCost = $derived(
    filteredOrders.reduce((sum, item) => sum + item.cost_amount, 0),
  );
  const owners = $derived([
    ...new Set(orders.map((o) => o.project_owner).filter(Boolean)),
  ]);
  const creators = $derived([
    ...new Set(orders.map((o) => o.created_by).filter(Boolean)),
  ]);

  function notify(text: string, isError = false) {
    message = isError ? "" : text;
    error = isError ? text : "";
    setTimeout(() => {
      message = "";
      error = "";
    }, 3500);
  }
  function closeSubmitMenu() {
    submitMenuOpen = false;
  }
  function onServiceInput() {
    // Editing a catalog-derived name means this is now a custom order.
    // Do not silently retain the old catalog relationship and pricing.
    if (catalogId) {
      catalogId = "";
      specification = "";
    }
  }
  onMount(() => {
    const storedName = window.localStorage.getItem(creatorNameStorageKey) || "";
    creatorName = storedName;
    creatorNameDraft = storedName;
    createdBy = storedName;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".submit-dropdown"))
        closeSubmitMenu();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSubmitMenu();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", escape);
    };
  });
  function saveCreatorName() {
    const name = creatorNameDraft.trim();
    if (!name) {
      notify("请输入要保存的名字", true);
      return;
    }
    window.localStorage.setItem(creatorNameStorageKey, name);
    creatorName = name;
    createdBy = name;
    settingsOpen = false;
    notify("填写人名字已保存，将在订单录入时自动填入");
  }
  function removeCreatorName() {
    window.localStorage.removeItem(creatorNameStorageKey);
    creatorName = "";
    creatorNameDraft = "";
    createdBy = "";
    settingsOpen = false;
    notify("已删除保存的填写人名字");
  }
  function openSettings() {
    creatorNameDraft = creatorName;
    settingsOpen = true;
  }
  function syncTotals() {
    const q = Number(unitQuote || 0);
    const c = Number(unitCost || 0);
    const n = Number(quantity || 0);
    quoteAmount = (q * n).toFixed(2);
    costAmount = (c * n).toFixed(2);
  }
  function applyCatalog() {
    if (!selectedCatalog) {
      specification = "";
      return;
    }
    serviceName = selectedCatalog.name;
    unit = selectedCatalog.unit;
    specification = selectedCatalog.specification || "";
    unitQuote = (selectedCatalog.quote_unit / 100).toFixed(2);
    unitCost = (selectedCatalog.cost_unit / 100).toFixed(2);
    syncTotals();
  }
  function applySuggestion(item: Catalog) {
    catalogId = item.id;
    serviceName = item.name;
    unit = item.unit;
    specification = item.specification || "";
    unitQuote = (item.quote_unit / 100).toFixed(2);
    unitCost = (item.cost_unit / 100).toFixed(2);
    syncTotals();
  }
  function onCustomerChange() {
    projectId = "";
  }
  function onQuantityChange() {
    syncTotals();
  }
  async function refresh() {
    const [o, c, p, k, r] = await Promise.all([
      api.get<{ data: Order[] }>("/api/orders"),
      api.get<{ data: Customer[] }>("/api/customers"),
      api.get<{ data: Project[] }>("/api/projects"),
      api.get<{ data: Catalog[] }>("/api/catalog"),
      api.get<{ data: Reimbursement[] }>("/api/reimbursements"),
    ]);
    orders = o.data;
    customers = c.data;
    projects = p.data;
    catalog = k.data;
    reimbursements = r.data;
  }
  async function markReimbursement(item: Reimbursement, status: string) {
    busy = true;
    try {
      await fetch(`/api/reimbursements/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, actor: "财务人员" }),
      });
      await refresh();
      notify(status === "已报销" ? "已标记为已报销" : "已更新报销状态");
    } catch (e) {
      notify(e instanceof Error ? e.message : "状态更新失败", true);
    } finally {
      busy = false;
    }
  }
  async function submitOrder(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    try {
      const result = await api.post<{ data: Order }>("/api/orders", {
        project_id: projectId,
        catalog_id: catalogId,
        service_name: serviceName,
        quantity,
        unit,
        quote_amount: quoteAmount,
        cost_amount: costAmount,
        order_date: orderDate,
        created_by: createdBy,
        note,
        specification,
        submit_reimbursement: submitMode === "reimburse",
      });
      for (const file of noteFiles)
        await fetch(`/api/orders/${result.data.id}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: file.name,
            mime_type: file.type,
            file_size: file.size,
          }),
        });
      await refresh();
      notify(
        submitMode === "reimburse"
          ? "订单已提交报销，已进入报销核验"
          : "订单已保存",
      );
      view = "overview";
      serviceName = "";
      specification = "";
      unitQuote = "";
      unitCost = "";
      quoteAmount = "";
      costAmount = "";
      note = "";
      catalogId = "";
      noteFiles = [];
      createdBy = creatorName;
      submitMode = "save";
      submitMenuOpen = false;
    } catch (e) {
      notify(e instanceof Error ? e.message : "订单保存失败", true);
    } finally {
      busy = false;
    }
  }
  async function submitProject() {
    if (!newCustomer.trim() || !newProject.trim()) return;
    busy = true;
    try {
      const result = await api.post<{ data: Project }>("/api/projects", {
        customer: newCustomer,
        name: newProject,
        owner: newOwner,
      });
      await refresh();
      customerId = result.data.customer_id;
      projectId = result.data.id;
      newCustomer = "";
      newProject = "";
      newOwner = "";
      showProjectForm = false;
      notify("项目已创建");
    } catch (e) {
      notify(e instanceof Error ? e.message : "项目创建失败", true);
    } finally {
      busy = false;
    }
  }
  async function importFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    busy = true;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]],
      );
      const result = await api.post<{ data: number }>("/api/catalog", { rows });
      await refresh();
      notify(`已导入 ${result.data} 条报价成本记录`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "文件导入失败", true);
    } finally {
      busy = false;
      (event.currentTarget as HTMLInputElement).value = "";
    }
  }
  function toggleOrder(id: string) {
    selectedOrderIds = selectedOrderIds.includes(id)
      ? selectedOrderIds.filter((item) => item !== id)
      : [...selectedOrderIds, id];
  }
  function toggleFilteredOrders() {
    const ids = new Set(selectedOrderIds);
    if (allFilteredSelected)
      filteredOrders.forEach((order) => ids.delete(order.id));
    else filteredOrders.forEach((order) => ids.add(order.id));
    selectedOrderIds = [...ids];
  }
  function openExport() {
    selectedOrderIds = filteredOrders.map((order) => order.id);
    showExport = true;
  }
  function downloadExport() {
    const params = new URLSearchParams({
      from: filterFrom,
      to: filterTo,
      creator: filterCreator,
      owner: filterOwner,
      customer: filterCustomer,
      project: filterProject,
      ids: selectedOrderIds.join(","),
      columns: selectedColumns.join(","),
    });
    window.location.href = `/api/orders/export?${params}`;
    showExport = false;
  }
  function toggleColumn(key: string) {
    selectedColumns = selectedColumns.includes(key)
      ? selectedColumns.filter((item) => item !== key)
      : [...selectedColumns, key];
  }
  async function deleteOrder(order: Order) {
    if (
      !window.confirm(
        `确认删除订单“${order.service_name}”（${order.code}）？删除后不可恢复。`,
      )
    )
      return;
    busy = true;
    try {
      await api.delete(`/api/orders/${encodeURIComponent(order.id)}`);
      selectedOrderIds = selectedOrderIds.filter((id) => id !== order.id);
      await refresh();
      notify("订单已删除");
    } catch (e) {
      notify(e instanceof Error ? e.message : "订单删除失败", true);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>企业订单工作台</title><meta
    name="description"
    content="快捷录入和总览企业订单信息"
  /></svelte:head
>
<div class:sidebar-collapsed={sidebarCollapsed} class="order-app">
  <aside class="order-sidebar">
    <button
      class="sidebar-toggle"
      title={sidebarCollapsed ? "展开菜单" : "收起菜单"}
      aria-label={sidebarCollapsed ? "展开菜单" : "收起菜单"}
      onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
      ><Menu size={18} /><span>{sidebarCollapsed ? "展开" : "收起菜单"}</span
      ></button
    >
    <div class="order-brand">
      <div class="brand-mark-small">O</div>
      <div><b>ORBIT OA</b><span>订单工作台</span></div>
    </div>
    <div class="side-caption">工作台</div>
    <button
      class:active={view === "overview"}
      onclick={() => (view = "overview")}
      ><LayoutDashboard size={17} />订单总览</button
    >
    <button class:active={view === "entry"} onclick={() => (view = "entry")}
      ><Plus size={17} />录入订单</button
    >
    <button class:active={view === "catalog"} onclick={() => (view = "catalog")}
      ><FileSpreadsheet size={17} />报价成本库</button
    >
    <button class:active={view === "finance"} onclick={() => (view = "finance")}
      ><WalletCards size={17} />报销核验</button
    >
    <div class="sidebar-note">
      <b>{creatorName || "未设置填写人"}</b><span>当前填写人</span><button
        class="settings-action"
        onclick={openSettings}><Settings size={14} />设置填写人</button
      >
    </div>
  </aside>
  <main class="order-main">
    <header class="order-topbar">
      <div>
        <span class="top-eyebrow">ENTERPRISE ORDER DESK</span>
        <h1>
          {view === "overview"
            ? "订单总览"
            : view === "entry"
              ? "快捷录入订单"
              : view === "finance"
                ? "员工垫付 / 报销核验"
                : "报价 / 成本库"}
        </h1>
      </div>
      <div class="top-actions">
        <button class="icon-control" title="刷新数据" onclick={() => refresh()}
          ><RefreshCw size={17} /></button
        ><button class="outline-action" onclick={openExport}
          ><Download size={16} />导出订单</button
        ><button class="primary-action" onclick={() => (view = "entry")}
          ><Plus size={16} />录入订单</button
        >
      </div>
    </header>
    {#if message}<div class="flash success">{message}</div>{/if}{#if error}<div
        class="flash error"
      >
        {error}
      </div>{/if}
    {#if view === "overview"}
      <section class="page-section">
        <div class="section-heading">
          <div>
            <p class="section-kicker">OPERATIONS</p>
            <h2>全部订单</h2>
            <span>按订单日期、客户和项目负责人快速定位信息</span>
          </div>
          <div class="heading-count">
            {filteredOrders.length}<small>笔订单</small>
          </div>
        </div>
        <div class="summary-row">
          <div><span>订单数</span><b>{filteredOrders.length}</b></div>
          <div><span>报价合计</span><b>{money(totalQuote)}</b></div>
          <div><span>成本合计</span><b>{money(totalCost)}</b></div>
          <div>
            <span>预计毛利</span><b class="positive"
              >{money(totalQuote - totalCost)}</b
            >
          </div>
        </div>
        <div class="project-stats">
          <div class="stats-title">
            <b>项目报价 / 成本汇总</b><span
              >不受列表筛选影响，统计每个项目的全部订单</span
            >
          </div>
          <div class="stats-grid">
            {#each projectStats as project}<div class="project-stat">
                <b>{project.name}</b><small
                  >{project.customer_name} · {project.orderCount} 笔订单</small
                >
                <div>
                  <span>全部报价 <strong>{money(project.quote)}</strong></span
                  ><span
                    >全部成本 <strong class="cost">{money(project.cost)}</strong
                    ></span
                  >
                </div>
                <em>预计毛利 {money(project.quote - project.cost)}</em>
              </div>{:else}<span class="muted">暂无可统计项目</span>{/each}
          </div>
        </div>
        <div class="filter-bar">
          <label class="search-field"
            ><Search size={16} /><input
              bind:value={search}
              placeholder="搜索订单号、客户、项目或订单内容"
            /></label
          ><select bind:value={filterCustomer}
            ><option value="">全部客户</option
            >{#each customers as customer}<option value={customer.id}
                >{customer.name}</option
              >{/each}</select
          ><select bind:value={filterProject}
            ><option value="">全部项目</option
            >{#each projects.filter((item) => !filterCustomer || item.customer_id === filterCustomer) as project}<option
                value={project.id}>{project.name}</option
              >{/each}</select
          ><select bind:value={filterOwner}
            ><option value="">全部负责人</option>{#each owners as owner}<option
                value={owner}>{owner}</option
              >{/each}</select
          ><select bind:value={filterCreator}
            ><option value="">全部录入人</option
            >{#each creators as creator}<option value={creator}
                >{creator}</option
              >{/each}</select
          ><label class="date-field"
            ><span>从</span><input type="date" bind:value={filterFrom} /></label
          ><label class="date-field"
            ><span>至</span><input type="date" bind:value={filterTo} /></label
          ><button
            class="filter-icon"
            title="导出当前筛选结果"
            onclick={openExport}><ListFilter size={17} /></button
          >
        </div>
        <div class="table-panel">
          <div class="table-scroll">
            <table>
              <thead
                ><tr
                  ><th>导出</th><th>订单信息</th><th>客户 / 项目</th><th
                    >负责人</th
                  ><th>报价</th><th>成本</th><th>录入人</th><th>日期</th><th
                    >状态</th
                  ><th>操作</th></tr
                ></thead
              ><tbody
                >{#each filteredOrders as order}<tr
                    ><td
                      ><input
                        type="checkbox"
                        aria-label={`选择导出 ${order.service_name}`}
                        checked={selectedOrderIds.includes(order.id)}
                        onchange={() => toggleOrder(order.id)}
                      /></td
                    ><td
                      ><b>{order.service_name}</b><small
                        >{order.code} · {order.quantity}{order.unit}</small
                      ></td
                    ><td
                      ><b>{order.customer_name}</b><small
                        >{order.project_name}</small
                      ></td
                    ><td>{order.project_owner || "未分配"}</td><td class="money"
                      >{money(order.quote_amount)}</td
                    ><td class="money cost">{money(order.cost_amount)}</td><td
                      >{order.created_by}</td
                    ><td>{order.order_date}</td><td
                      ><span class="status-dot">{order.status}</span
                      >{#if order.reimbursement_status === "待核验" || order.reimbursement_status === "待报销"}<small
                          class="status-dot">需报销</small
                        >{/if}</td
                    ><td
                      ><button
                        class="delete-action"
                        title="删除订单"
                        aria-label={`删除订单 ${order.service_name}`}
                        disabled={busy}
                        onclick={() => deleteOrder(order)}
                        ><Trash2 size={15} /></button
                      ></td
                    ></tr
                  >{:else}<tr
                    ><td colspan="10"
                      ><div class="empty-table">
                        没有匹配的订单，先录入一笔订单吧。
                      </div></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        </div>
      </section>
    {:else if view === "entry"}
      <section class="entry-layout">
        <form class="order-form" onsubmit={submitOrder}>
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
                bind:value={customerId}
                onchange={onCustomerChange}
                required
                ><option value="">请选择客户</option
                >{#each customers as customer}<option value={customer.id}
                    >{customer.name}</option
                  >{/each}</select
              ></label
            ><label
              >项目 <em>*</em><select
                bind:value={projectId}
                required
                disabled={!customerId}
                ><option value=""
                  >{customerId ? "请选择项目" : "先选择客户"}</option
                >{#each filteredProjects as project}<option value={project.id}
                    >{project.name} · {project.owner || "未分配负责人"}</option
                  >{/each}</select
              ></label
            >
            <div class="full inline-create">
              <span>没有找到对应项目？</span><button
                type="button"
                onclick={() => (showProjectForm = true)}
                ><Plus size={14} />新建项目</button
              >
            </div>
            <label class="full order-content-field"
              >订单内容 <em>*</em><input
                bind:value={serviceName}
                oninput={onServiceInput}
                placeholder="直接输入订单内容，系统会实时推荐报价成本库条目"
                required
              /><small class="field-hint"
                >已选客户：{selectedCustomer || "未选择"} · 已选项目：{selectedProject ||
                  "未选择"}</small
              >{#if serviceName.trim() && catalogSuggestions.length}<div
                  class="catalog-suggestions"
                >
                  <span>报价成本库推荐</span
                  >{#each catalogSuggestions as item}<button
                      type="button"
                      onclick={() => applySuggestion(item)}
                      ><b>{item.name}</b><small
                        >{item.category || "未分类"}{item.customer_name
                          ? ` · ${item.customer_name}`
                          : ""}{item.project_name
                          ? ` · ${item.project_name}`
                          : ""}</small
                      ><strong
                        >{money(item.quote_unit)} / {money(item.cost_unit)} · {item.unit}</strong
                      ></button
                    >{/each}
                </div>{:else if serviceName.trim()}<small class="field-hint"
                  >没有匹配的库内条目，可继续手动填写。</small
                >{/if}</label
            ><label
              >数量 <input
                type="number"
                min="0.01"
                step="0.01"
                bind:value={quantity}
                onchange={onQuantityChange}
              /></label
            ><label
              >单位 <input
                bind:value={unit}
                placeholder="项、套、人天"
              /></label
            ><label
              >单位报价（元） <em>*</em><input
                type="number"
                min="0"
                step="0.01"
                bind:value={unitQuote}
                oninput={syncTotals}
                placeholder="0.00"
                required
              /></label
            ><label
              >单位成本（元） <em>*</em><input
                type="number"
                min="0"
                step="0.01"
                bind:value={unitCost}
                oninput={syncTotals}
                placeholder="0.00"
                required
              /></label
            ><label>总报价（元） <input value={quoteAmount} readonly /></label
            ><label>总成本（元） <input value={costAmount} readonly /></label
            ><label class="full"
              >规格和技术要求 <textarea
                bind:value={specification}
                placeholder="选择报价成本库后自动填充，也可以留空"
              ></textarea></label
            ><label
              >报价成本库 <span class="optional-mark"
                >输入订单内容后自动推荐</span
              ><select bind:value={catalogId} onchange={applyCatalog}
                ><option value="">不使用推荐条目</option
                >{#each catalog as item}<option value={item.id}
                    >{item.category ? `${item.category} / ` : ""}{item.name} · 报价
                    {money(item.quote_unit)} / {item.unit}</option
                  >{/each}</select
              ></label
            ><label>订单日期 <input type="date" bind:value={orderDate} /></label
            ><label
              >录入人 <input
                bind:value={createdBy}
                placeholder={creatorName || "请设置或填写名字"}
              /><small class="field-hint"
                >{creatorName
                  ? "已自动填入浏览器中保存的名字，可按本单修改。"
                  : "可在左下角“设置填写人”中保存常用名字。"}</small
              ></label
            ><label class="full"
              >备注 <textarea
                bind:value={note}
                placeholder="补充交付说明、来源或其他需要留痕的信息"
              ></textarea><small class="field-hint"
                >未选择报价成本库的订单会进入报销核验。</small
              ></label
            ><label class="full upload-note-field"
              ><span
                >备注附件 <small class="optional-mark"
                  >空实现，仅保存文件元数据</small
                ></span
              ><input
                type="file"
                multiple
                onchange={(event) => {
                  noteFiles = [
                    ...((event.currentTarget as HTMLInputElement).files || []),
                  ];
                }}
              /><small class="field-hint"
                >{noteFiles.length
                  ? `已选择 ${noteFiles.length} 个文件：${noteFiles.map((file) => file.name).join("、")}`
                  : "可选择发票、付款截图等文件，当前不会上传文件内容。"}</small
              ></label
            >
          </div>
          <div class="form-footer">
            <span
              >提交报销的订单会在订单总览标记“需报销”，并同步到报销核验。</span
            >
            <div class="submit-dropdown" class:open={submitMenuOpen}>
              <div class="submit-group">
                <button
                  type="submit"
                  class="primary-action"
                  disabled={busy || !projectId}
                  >{busy
                    ? "保存中..."
                    : submitMode === "reimburse"
                      ? "提交报销"
                      : "保存订单"}</button
                ><button
                  type="button"
                  class="submit-caret"
                  aria-label="选择订单提交方式"
                  aria-haspopup="menu"
                  aria-expanded={submitMenuOpen}
                  onclick={(event) => {
                    event.stopPropagation();
                    submitMenuOpen = !submitMenuOpen;
                  }}><span></span></button
                >
              </div>
              {#if submitMenuOpen}<div class="submit-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      submitMode = "save";
                      closeSubmitMenu();
                    }}>保存订单</button
                  ><button
                    type="button"
                    role="menuitem"
                    onclick={() => {
                      submitMode = "reimburse";
                      closeSubmitMenu();
                    }}>提交报销</button
                  >
                </div>{/if}
            </div>
          </div>
        </form>
      </section>
    {:else if view === "finance"}
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
          <select bind:value={reimbursementProject}
            ><option value="">全部项目</option
            >{#each projects as project}<option value={project.id}
                >{project.name}</option
              >{/each}</select
          ><select bind:value={reimbursementPerson}
            ><option value="">全部人员</option>{#each creators as person}<option
                value={person}>{person}</option
              >{/each}</select
          ><select bind:value={reimbursementStatus}
            ><option value="">全部状态</option><option value="待核验"
              >待核验</option
            ><option value="待报销">待报销</option><option value="已报销"
              >已报销</option
            ></select
          ><label class="date-field"
            ><span>从</span><input
              type="date"
              bind:value={reimbursementFrom}
            /></label
          ><label class="date-field"
            ><span>至</span><input
              type="date"
              bind:value={reimbursementTo}
            /></label
          >
        </div>
        <div class="table-panel">
          <div class="table-scroll">
            <table>
              <thead
                ><tr
                  ><th>订单</th><th>项目 / 人员</th><th>日期</th><th
                    >订单内容</th
                  ><th>金额</th><th>备注附件</th><th>报销状态</th><th>操作</th
                  ></tr
                ></thead
              ><tbody
                >{#each reimbursements.filter((item) => (!reimbursementProject || item.project_id === reimbursementProject) && (!reimbursementPerson || item.created_by === reimbursementPerson) && (!reimbursementStatus || item.reimbursement_status === reimbursementStatus) && (!reimbursementFrom || item.order_date >= reimbursementFrom) && (!reimbursementTo || item.order_date <= reimbursementTo)) as item}<tr
                    ><td><b>{item.code}</b></td><td
                      ><b>{item.project_name}</b><small>{item.created_by}</small
                      ></td
                    ><td>{item.order_date}</td><td>{item.service_name}</td><td
                      class="money">{money(item.cost_amount)}</td
                    ><td
                      ><Paperclip size={14} />
                      {item.attachment_count
                        ? `${item.attachment_count} 个`
                        : "未上传"}</td
                    ><td
                      ><span class="status-dot"
                        >{item.reimbursement_status}</span
                      ></td
                    ><td
                      >{#if item.reimbursement_status === "待核验"}<button
                          class="primary-action"
                          onclick={() => markReimbursement(item, "待报销")}
                          >确认待报销</button
                        >{:else if item.reimbursement_status === "待报销"}<button
                          class="primary-action"
                          onclick={() => markReimbursement(item, "已报销")}
                          >标记已报销</button
                        >{:else}<span class="muted">已完成</span>{/if}</td
                    ></tr
                  >{:else}<tr
                    ><td colspan="8"
                      ><div class="empty-table">
                        暂无需要报销核验的订单。
                      </div></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        </div>
      </section>
    {:else}
      <section class="page-section">
        <div class="section-heading">
          <div>
            <p class="section-kicker">REFERENCE DATA</p>
            <h2>报价 / 成本库</h2>
            <span>查看已导入的报价和成本条目，也可在录入订单时实时匹配推荐</span
            >
          </div>
          <label class="upload-action"
            ><Upload size={16} />导入 Excel<input
              type="file"
              accept=".xlsx,.xls,.csv"
              onchange={importFile}
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
              bind:value={catalogSearch}
              placeholder="搜索名称、分类、客户或项目"
            /></label
          ><select bind:value={catalogCategory}
            ><option value="">全部分类</option
            >{#each catalogCategories as category}<option value={category}
                >{category}</option
              >{/each}</select
          ><span>共 {visibleCatalog.length} 条</span>
        </div>
        <div class="table-panel">
          <div class="table-scroll">
            <table>
              <thead
                ><tr
                  ><th>分类</th><th>服务名称</th><th>适用客户</th><th
                    >适用项目</th
                  ><th>单位</th><th>报价单价</th><th>成本单价</th><th
                    >预估毛利</th
                  ></tr
                ></thead
              ><tbody
                >{#each visibleCatalog as item}<tr
                    ><td
                      ><span class="category-label"
                        >{item.category || "未分类"}</span
                      ></td
                    ><td><b>{item.name}</b></td><td
                      >{item.customer_name || "通用"}</td
                    ><td>{item.project_name || "通用"}</td><td>{item.unit}</td
                    ><td class="money">{money(item.quote_unit)}</td><td
                      class="money cost">{money(item.cost_unit)}</td
                    ><td class="money positive"
                      >{money(item.quote_unit - item.cost_unit)}</td
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
    {/if}
  </main>
</div>
{#if showProjectForm}<div
    class="project-modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showProjectForm = false;
    }}
  >
    <div
      class="project-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
    >
      <div class="project-modal-head">
        <div>
          <p class="section-kicker">NEW PROJECT</p>
          <h2 id="project-modal-title">新建项目</h2>
          <span>创建成功后将自动选中该项目。</span>
        </div>
        <button
          class="icon-control project-modal-close"
          aria-label="关闭新建项目窗口"
          title="关闭"
          onclick={() => (showProjectForm = false)}><X size={18} /></button
        >
      </div>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          submitProject();
        }}
      >
        <div class="project-modal-body">
          <label
            >客户名称 <em>*</em><input
              bind:value={newCustomer}
              placeholder="例如：华东科技有限公司"
              required
            /></label
          ><label
            >项目名称 <em>*</em><input
              bind:value={newProject}
              placeholder="例如：办公楼改造项目"
              required
            /></label
          ><label
            >项目负责人<input
              bind:value={newOwner}
              placeholder="例如：张三"
            /></label
          >
        </div>
        <div class="project-modal-footer">
          <button
            type="button"
            class="outline-action"
            onclick={() => (showProjectForm = false)}>取消</button
          ><button type="submit" class="primary-action" disabled={busy}
            >{busy ? "保存中..." : "保存项目"}</button
          >
        </div>
      </form>
    </div>
  </div>{/if}
{#if settingsOpen}<div
    class="drawer-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) settingsOpen = false;
    }}
  >
    <div
      class="export-drawer settings-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="creator-settings-title"
    >
      <div class="drawer-head">
        <div>
          <p class="section-kicker">PERSONAL SETTINGS</p>
          <h2 id="creator-settings-title">设置填写人</h2>
          <span>名字会保存在当前浏览器中，不会自动过期。</span>
        </div>
        <button
          class="icon-control"
          aria-label="关闭设置"
          onclick={() => (settingsOpen = false)}><X size={17} /></button
        >
      </div>
      <div class="drawer-body">
        <label class="settings-name-field"
          >常用名字<input
            bind:value={creatorNameDraft}
            maxlength="40"
            placeholder="例如：张三"
            onkeydown={(event) => {
              if (event.key === "Enter") saveCreatorName();
            }}
          /></label
        >
        <p class="settings-hint">
          保存后，新建订单的“录入人”会自动填入该名字。你仍可以在单笔订单中修改录入人。
        </p>
      </div>
      <div class="drawer-footer">
        <button
          class="delete-action"
          disabled={!creatorName}
          onclick={removeCreatorName}>删除已保存名字</button
        ><button class="primary-action" onclick={saveCreatorName}
          >保存名字</button
        >
      </div>
    </div>
  </div>{/if}
{#if showExport}<div
    class="drawer-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget) showExport = false;
    }}
  >
    <section class="export-drawer" role="dialog" aria-modal="true">
      <div class="drawer-head">
        <div>
          <p class="section-kicker">EXPORT</p>
          <h2>导出订单</h2>
          <span>当前筛选条件会一并应用到导出结果</span>
        </div>
        <button class="icon-control" onclick={() => (showExport = false)}
          ><X size={17} /></button
        >
      </div>
      <div class="drawer-body">
        <div class="export-selection">
          <div class="picker-head">
            <b>选择导出订单</b><span>已选 {selectedOrderIds.length} 条</span>
          </div>
          <label
            ><input
              type="checkbox"
              checked={allFilteredSelected}
              onchange={toggleFilteredOrders}
            /> 全选当前筛选结果</label
          >
          <div class="selection-list">
            {#each filteredOrders as order}<label
                ><input
                  type="checkbox"
                  checked={selectedOrderIds.includes(order.id)}
                  onchange={() => toggleOrder(order.id)}
                /><span
                  >{order.service_name} · {order.project_name}
                  <small>{order.code}</small></span
                ></label
              >{:else}<span class="muted">当前筛选无订单</span>{/each}
          </div>
        </div>
        <div class="drawer-filter-grid">
          <label>开始日期<input type="date" bind:value={filterFrom} /></label
          ><label>结束日期<input type="date" bind:value={filterTo} /></label
          ><label
            >客户<select bind:value={filterCustomer}
              ><option value="">全部客户</option
              >{#each customers as customer}<option value={customer.id}
                  >{customer.name}</option
                >{/each}</select
            ></label
          ><label
            >项目<select bind:value={filterProject}
              ><option value="">全部项目</option
              >{#each projects.filter((item) => !filterCustomer || item.customer_id === filterCustomer) as project}<option
                  value={project.id}>{project.name}</option
                >{/each}</select
            ></label
          ><label
            >项目负责人<select bind:value={filterOwner}
              ><option value="">全部负责人</option
              >{#each owners as owner}<option value={owner}>{owner}</option
                >{/each}</select
            ></label
          ><label
            >录入人<select bind:value={filterCreator}
              ><option value="">全部录入人</option
              >{#each creators as creator}<option value={creator}
                  >{creator}</option
                >{/each}</select
            ></label
          >
        </div>
        <div class="column-picker">
          <div class="picker-head">
            <b>导出列</b><span>已选 {selectedColumns.length} 列</span>
          </div>
          <div class="column-list">
            {#each exportColumns as [key, label]}<label
                ><input
                  type="checkbox"
                  checked={selectedColumns.includes(key)}
                  onchange={() => toggleColumn(key)}
                /><span>{label}</span></label
              >{/each}
          </div>
        </div>
      </div>
      <div class="drawer-footer">
        <span>预计导出 {selectedOrderIds.length} 条记录</span><button
          class="primary-action"
          disabled={!selectedColumns.length || !selectedOrderIds.length}
          onclick={downloadExport}><Download size={16} />下载 Excel</button
        >
      </div>
    </section>
  </div>{/if}
