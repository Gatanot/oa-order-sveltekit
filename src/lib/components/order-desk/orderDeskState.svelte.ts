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

export type Data = {
    customers: Customer[];
    projects: Project[];
    catalog: Catalog[];
    orders: Order[];
    reimbursements: Reimbursement[];
  };


export function createOrderDesk(data: Data) {
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


  const desk = {} as Record<string, any>;
  Object.defineProperty(desk, "view", { get: () => view, set: (value) => { view = value; } });
  Object.defineProperty(desk, "sidebarCollapsed", { get: () => sidebarCollapsed, set: (value) => { sidebarCollapsed = value; } });
  Object.defineProperty(desk, "customers", { get: () => customers, set: (value) => { customers = value; } });
  Object.defineProperty(desk, "projects", { get: () => projects, set: (value) => { projects = value; } });
  Object.defineProperty(desk, "catalog", { get: () => catalog, set: (value) => { catalog = value; } });
  Object.defineProperty(desk, "orders", { get: () => orders, set: (value) => { orders = value; } });
  Object.defineProperty(desk, "reimbursements", { get: () => reimbursements, set: (value) => { reimbursements = value; } });
  Object.defineProperty(desk, "customerId", { get: () => customerId, set: (value) => { customerId = value; } });
  Object.defineProperty(desk, "projectId", { get: () => projectId, set: (value) => { projectId = value; } });
  Object.defineProperty(desk, "catalogId", { get: () => catalogId, set: (value) => { catalogId = value; } });
  Object.defineProperty(desk, "serviceName", { get: () => serviceName, set: (value) => { serviceName = value; } });
  Object.defineProperty(desk, "quantity", { get: () => quantity, set: (value) => { quantity = value; } });
  Object.defineProperty(desk, "unit", { get: () => unit, set: (value) => { unit = value; } });
  Object.defineProperty(desk, "unitQuote", { get: () => unitQuote, set: (value) => { unitQuote = value; } });
  Object.defineProperty(desk, "unitCost", { get: () => unitCost, set: (value) => { unitCost = value; } });
  Object.defineProperty(desk, "quoteAmount", { get: () => quoteAmount, set: (value) => { quoteAmount = value; } });
  Object.defineProperty(desk, "costAmount", { get: () => costAmount, set: (value) => { costAmount = value; } });
  Object.defineProperty(desk, "specification", { get: () => specification, set: (value) => { specification = value; } });
  Object.defineProperty(desk, "orderDate", { get: () => orderDate, set: (value) => { orderDate = value; } });
  Object.defineProperty(desk, "createdBy", { get: () => createdBy, set: (value) => { createdBy = value; } });
  Object.defineProperty(desk, "note", { get: () => note, set: (value) => { note = value; } });
  Object.defineProperty(desk, "noteFiles", { get: () => noteFiles, set: (value) => { noteFiles = value; } });
  Object.defineProperty(desk, "creatorName", { get: () => creatorName, set: (value) => { creatorName = value; } });
  Object.defineProperty(desk, "creatorNameDraft", { get: () => creatorNameDraft, set: (value) => { creatorNameDraft = value; } });
  Object.defineProperty(desk, "settingsOpen", { get: () => settingsOpen, set: (value) => { settingsOpen = value; } });
  Object.defineProperty(desk, "newCustomer", { get: () => newCustomer, set: (value) => { newCustomer = value; } });
  Object.defineProperty(desk, "newProject", { get: () => newProject, set: (value) => { newProject = value; } });
  Object.defineProperty(desk, "newOwner", { get: () => newOwner, set: (value) => { newOwner = value; } });
  Object.defineProperty(desk, "showProjectForm", { get: () => showProjectForm, set: (value) => { showProjectForm = value; } });
  Object.defineProperty(desk, "busy", { get: () => busy, set: (value) => { busy = value; } });
  Object.defineProperty(desk, "message", { get: () => message, set: (value) => { message = value; } });
  Object.defineProperty(desk, "error", { get: () => error, set: (value) => { error = value; } });
  Object.defineProperty(desk, "reimbursementProject", { get: () => reimbursementProject, set: (value) => { reimbursementProject = value; } });
  Object.defineProperty(desk, "reimbursementPerson", { get: () => reimbursementPerson, set: (value) => { reimbursementPerson = value; } });
  Object.defineProperty(desk, "reimbursementStatus", { get: () => reimbursementStatus, set: (value) => { reimbursementStatus = value; } });
  Object.defineProperty(desk, "reimbursementFrom", { get: () => reimbursementFrom, set: (value) => { reimbursementFrom = value; } });
  Object.defineProperty(desk, "reimbursementTo", { get: () => reimbursementTo, set: (value) => { reimbursementTo = value; } });
  Object.defineProperty(desk, "search", { get: () => search, set: (value) => { search = value; } });
  Object.defineProperty(desk, "catalogSearch", { get: () => catalogSearch, set: (value) => { catalogSearch = value; } });
  Object.defineProperty(desk, "catalogCategory", { get: () => catalogCategory, set: (value) => { catalogCategory = value; } });
  Object.defineProperty(desk, "filterCustomer", { get: () => filterCustomer, set: (value) => { filterCustomer = value; } });
  Object.defineProperty(desk, "filterProject", { get: () => filterProject, set: (value) => { filterProject = value; } });
  Object.defineProperty(desk, "filterOwner", { get: () => filterOwner, set: (value) => { filterOwner = value; } });
  Object.defineProperty(desk, "filterCreator", { get: () => filterCreator, set: (value) => { filterCreator = value; } });
  Object.defineProperty(desk, "filterFrom", { get: () => filterFrom, set: (value) => { filterFrom = value; } });
  Object.defineProperty(desk, "filterTo", { get: () => filterTo, set: (value) => { filterTo = value; } });
  Object.defineProperty(desk, "submitMode", { get: () => submitMode, set: (value) => { submitMode = value; } });
  Object.defineProperty(desk, "submitMenuOpen", { get: () => submitMenuOpen, set: (value) => { submitMenuOpen = value; } });
  Object.defineProperty(desk, "showExport", { get: () => showExport, set: (value) => { showExport = value; } });
  Object.defineProperty(desk, "selectedOrderIds", { get: () => selectedOrderIds, set: (value) => { selectedOrderIds = value; } });
  Object.defineProperty(desk, "selectedColumns", { get: () => selectedColumns, set: (value) => { selectedColumns = value; } });
  Object.defineProperty(desk, "filteredProjects", { get: () => filteredProjects });
  Object.defineProperty(desk, "visibleCatalog", { get: () => visibleCatalog });
  Object.defineProperty(desk, "catalogCategories", { get: () => catalogCategories });
  Object.defineProperty(desk, "selectedCatalog", { get: () => selectedCatalog });
  Object.defineProperty(desk, "selectedCustomer", { get: () => selectedCustomer });
  Object.defineProperty(desk, "selectedProject", { get: () => selectedProject });
  Object.defineProperty(desk, "catalogSuggestions", { get: () => catalogSuggestions });
  Object.defineProperty(desk, "filteredOrders", { get: () => filteredOrders });
  Object.defineProperty(desk, "projectStats", { get: () => projectStats });
  Object.defineProperty(desk, "allFilteredSelected", { get: () => allFilteredSelected });
  Object.defineProperty(desk, "totalQuote", { get: () => totalQuote });
  Object.defineProperty(desk, "totalCost", { get: () => totalCost });
  Object.defineProperty(desk, "owners", { get: () => owners });
  Object.defineProperty(desk, "creators", { get: () => creators });
  desk.money = money;
  desk.refresh = refresh;
  desk.markReimbursement = markReimbursement;
  desk.submitOrder = submitOrder;
  desk.submitProject = submitProject;
  desk.importFile = importFile;
  desk.toggleOrder = toggleOrder;
  desk.toggleFilteredOrders = toggleFilteredOrders;
  desk.openExport = openExport;
  desk.downloadExport = downloadExport;
  desk.toggleColumn = toggleColumn;
  desk.deleteOrder = deleteOrder;
  desk.closeSubmitMenu = closeSubmitMenu;
  desk.onServiceInput = onServiceInput;
  desk.onCustomerChange = onCustomerChange;
  desk.onQuantityChange = onQuantityChange;
  desk.applyCatalog = applyCatalog;
  desk.applySuggestion = applySuggestion;
  desk.saveCreatorName = saveCreatorName;
  desk.removeCreatorName = removeCreatorName;
  desk.openSettings = openSettings;
  desk.syncTotals = syncTotals;
  desk.exportColumns = exportColumns;
  return desk;
}
