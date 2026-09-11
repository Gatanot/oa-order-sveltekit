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
    source_type?: string;
    supplier_remark?: string;
    raw_data?: string;
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
    customer_department?: string;
    designer?: string;
    delivery_date?: string;
    contact?: string;
    payment_status?: string;
    products?: Array<Record<string, any>>;
    costs?: Array<Record<string, any>>;
    advances?: Array<Record<string, any>>;
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
  let deliveryDate = $state("");
  let contact = $state("");
  let customerDepartment = $state("");
  let designer = $state("");
  let paymentStatus = $state("未结款");
  let status = $state("制作中");
  let products = $state<Array<Record<string, any>>>([]);
  let costs = $state<Array<Record<string, any>>>([]);
  let advances = $state<Array<Record<string, any>>>([]);
  let editingOrderId = $state("");
  let detailOrder = $state<any>(null);
  let detailAttachments = $state<any[]>([]);
  let detailAttachmentsLoading = $state(false);
  let uploadingFiles = $state(false);
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
  let filterDesigner = $state("");
  let filterCreator = $state("");
  let filterPayment = $state("");
  let filterFrom = $state("");
  let filterTo = $state("");
  let orderSort = $state("date_desc");
  let submitMode = $state<"save" | "reimburse">("save");
  let submitMenuOpen = $state(false);
  let showExport = $state(false);
  let showOrderFilters = $state(false);
  let selectedOrderIds = $state<string[]>([]);
  let visibleOrderColumns = $state(["department", "contact", "designer", "owner", "quote", "cost", "creator", "date", "delivery", "payment", "status"]);
  const orderColumnOptions = [
    ["department", "客户部门"], ["contact", "联系人"], ["designer", "设计师"],
    ["owner", "项目负责人"], ["quote", "报价"], ["cost", "成本"], ["creator", "录入人"],
    ["date", "下单日期"], ["delivery", "交货日期"], ["payment", "结款状态"], ["status", "状态"],
  ];
  let selectedColumns = $state([
    "code",
    "order_date",
    "customer_name",
    "project_name",
    "project_owner",
    "designer",
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
    ["customer_department", "客户部门"],
    ["designer", "设计师"],
    ["contact", "联系人"],
    ["delivery_date", "交货日期"],
    ["payment_status", "结款状态"],
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
  const formatFileSize = (size: number) =>
    size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(Math.round(size / 1024), 1)} KB`;
  const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;
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
          `${o.code}${o.customer_name}${o.project_name}${o.service_name}${o.customer_department || ""}${o.contact || ""}${o.designer || ""}${o.created_by || ""}${o.note || ""}${(o.products || []).map((item: any) => `${item.name || ""}${item.specification || ""}`).join("")}${(o.costs || []).map((item: any) => item.name || "").join("")}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!filterCustomer || o.customer_id === filterCustomer) &&
        (!filterProject || o.project_id === filterProject) &&
        (!filterOwner || o.project_owner === filterOwner) &&
        (!filterDesigner || o.designer === filterDesigner) &&
        (!filterCreator || o.created_by === filterCreator) &&
        (!filterPayment || o.payment_status === filterPayment) &&
        (!filterFrom || o.order_date >= filterFrom) &&
        (!filterTo || o.order_date <= filterTo),
    ).sort((a, b) => {
      if (orderSort === "date_asc") return a.order_date.localeCompare(b.order_date);
      if (orderSort === "quote_desc") return b.quote_amount - a.quote_amount;
      if (orderSort === "quote_asc") return a.quote_amount - b.quote_amount;
      if (orderSort === "delivery_asc") return (a.delivery_date || "9999-99-99").localeCompare(b.delivery_date || "9999-99-99");
      return b.order_date.localeCompare(a.order_date);
    }),
  );
  function resetOrderFilters() {
    search = ""; filterCustomer = ""; filterProject = ""; filterOwner = "";
    filterDesigner = ""; filterCreator = ""; filterPayment = ""; filterFrom = "";
    filterTo = ""; orderSort = "date_desc";
  }
  const projectStats = $derived(
    projects
      .map((project) => {
        const items = orders.filter((order) => order.project_id === project.id);
        return {
          ...project,
          orderCount: items.length,
          quote: items.reduce((sum, item) => sum + item.quote_amount, 0),
          cost: items.reduce((sum, item) => sum + item.cost_amount, 0),
          advance: items.reduce((sum, item) => sum + (item.advances || []).reduce((subtotal, advance) => subtotal + Math.round(Number(advance.amount || 0) * 100), 0), 0),
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
  const totalAdvance = $derived(
    filteredOrders.reduce((sum, item) => sum + (item.advances || []).reduce((subtotal, advance) => subtotal + Math.round(Number(advance.amount || 0) * 100), 0), 0),
  );
  const totalUnpaid = $derived(
    filteredOrders.filter((item) => (item.payment_status || "未结款") === "未结款").reduce((sum, item) => sum + item.quote_amount, 0),
  );
  const owners = $derived([
    ...new Set(orders.map((o) => o.project_owner).filter(Boolean)),
  ]);
  const designers = $derived([
    ...new Set(orders.map((o) => o.designer).filter(Boolean)),
  ]);
  const reimbursementPeople = $derived([
    ...new Set(reimbursements.map((item: any) => item.employee).filter(Boolean)),
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
  function onNoteFilesChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files || []);
    const isAllowed = (file: File) =>
      /^image\/(png|jpe?g|gif|webp)$/i.test(file.type) ||
      file.type === "application/pdf";
    const rejected = files.filter((file) => !isAllowed(file));
    const accepted = files.filter(isAllowed);
    const oversized = accepted.filter((file) => file.size > 10 * 1024 * 1024);
    const allowed = accepted.filter((file) => file.size <= 10 * 1024 * 1024);
    const room = Math.max(10 - noteFiles.length, 0);
    const kept = allowed.slice(0, room);
    const overflow = allowed.length - kept.length;
    noteFiles = [...noteFiles, ...kept];
    input.value = "";
    const messages: string[] = [];
    if (rejected.length)
      messages.push(`${rejected.length} 个文件不是图片或 PDF，已忽略`);
    if (oversized.length)
      messages.push(`${oversized.length} 个文件超过 10MB，已忽略`);
    if (overflow > 0) messages.push("最多选择 10 个附件");
    if (messages.length) notify(messages.join("；"), true);
  }
  function removeNoteFile(index: number) {
    noteFiles = noteFiles.filter((_, i) => i !== index);
  }
  function onAdvanceInvoiceChange(event: Event, index: number) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const isAllowed =
      /^image\/(png|jpe?g|gif|webp)$/i.test(file.type) ||
      file.type === "application/pdf";
    if (!isAllowed) {
      notify("发票仅支持图片或 PDF 文件", true);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify("发票文件不能超过 10MB", true);
      return;
    }
    advances[index] = { ...advances[index], invoice: file.name, invoiceFile: file };
    advances = [...advances];
    notify("发票已选择，保存订单时上传");
  }
  function removeAdvanceInvoice(index: number) {
    advances[index] = { ...advances[index], invoice: "", invoiceFile: null };
    advances = [...advances];
  }
  async function uploadAttachments(orderId: string, savedAdvances: Array<Record<string, any>>, submittedAdvances: Array<Record<string, any>>) {
    const invoices = submittedAdvances.map((advance, index) => ({ file: advance.invoiceFile as File | null, advanceId: savedAdvances[index]?.id })).filter((item): item is { file: File; advanceId: string } => item.file instanceof File && Boolean(item.advanceId));
    if (!noteFiles.length && !invoices.length) return;
    uploadingFiles = true;
    try {
      if (noteFiles.length) await postAttachments(orderId, noteFiles);
      for (const invoice of invoices) await postAttachments(orderId, [invoice.file], { kind: "invoice", advanceId: invoice.advanceId });
    } finally {
      uploadingFiles = false;
    }
  }
  async function postAttachments(orderId: string, files: File[], relation?: { kind: string; advanceId: string }) {
    const form = new FormData();
    for (const file of files) form.append("files", file, file.name);
    if (relation) {
      form.append("kind", relation.kind);
      form.append("advance_id", relation.advanceId);
    }
    const response = await fetch(
      `/api/orders/${encodeURIComponent(orderId)}/attachments`,
      { method: "POST", body: form },
    );
    if (!response.ok) {
      const text = await response.text();
      let detail = `附件上传失败（HTTP ${response.status}）`;
      try {
        detail = JSON.parse(text)?.detail || detail;
      } catch {
        /* 非 JSON 错误响应 */
      }
      throw new Error(detail);
    }
  }
  async function loadDetailAttachments(orderId: string) {
    detailAttachmentsLoading = true;
    try {
      const result = await api.get<{
        data: Array<Record<string, any>>;
      }>(`/api/orders/${encodeURIComponent(orderId)}/attachments`);
      detailAttachments = result.data;
      return result.data;
    } catch {
      detailAttachments = [];
      return [];
    } finally {
      detailAttachmentsLoading = false;
    }
  }
  async function submitOrder(event: SubmitEvent) {
    event.preventDefault();
    const hasName = (value: string) => String(value || '').trim().length > 0;
    if (!hasName(customerDepartment) && !hasName(contact)) {
      notify("客户部门和联系人 / 下单人至少填写一项", true);
      return;
    }
    const validProducts = products.filter((item) => hasName(item.name));
    const validCosts = costs.filter((item) => hasName(item.name));
    // 垫付行填写了物品名或金额大于 0 均视为有效（金额可先记，物品名后补）
    const validAdvances = advances.filter((item) => hasName(item.item) || Number(item.amount) > 0);
    if (!validProducts.length && !validCosts.length && !validAdvances.length) {
      notify("请至少填写一项产品、固定成本或员工垫付", true);
      return;
    }
    busy = true;
    try {
      const payload = { project_id: projectId, catalog_id: catalogId, service_name: serviceName, quantity, unit, quote_amount: quoteAmount, cost_amount: costAmount, order_date: orderDate, delivery_date: deliveryDate, contact, customer_department: customerDepartment, designer, payment_status: paymentStatus, status, created_by: createdBy, note, specification, products: validProducts, costs: validCosts, advances: validAdvances, submit_reimbursement: submitMode === "reimburse" };
      const result = editingOrderId
        ? await api.patch<{ data: Order }>(`/api/orders/${editingOrderId}`, payload)
        : await api.post<{ data: Order }>("/api/orders", payload);
      await uploadAttachments(result.data.id, result.data.advances || [], validAdvances);
      await refresh();
      notify(
        submitMode === "reimburse" || advances.length
          ? "订单已提交报销，已进入报销核验"
          : editingOrderId ? "订单已更新" : "订单已保存",
      );
      view = "overview";
      editingOrderId = "";
      detailOrder = null;
      products = [];
      costs = [];
      advances = [];
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
      deliveryDate = "";
      contact = "";
      customerDepartment = "";
      designer = "";
      paymentStatus = "未结款";
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
  function openDetail(order: any) {
    detailOrder = order;
    detailAttachments = [];
    loadDetailAttachments(order.id);
  }
  function editOrder(order: any) {
    editingOrderId = order.id;
    customerId = order.customer_id;
    projectId = order.project_id;
    serviceName = order.service_name;
    quantity = Number(order.quantity || 1);
    unit = order.unit || "项";
    quoteAmount = (Number(order.quote_amount || 0) / 100).toFixed(2);
    costAmount = (Number(order.cost_amount || 0) / 100).toFixed(2);
    orderDate = order.order_date;
    deliveryDate = order.delivery_date || "";
    contact = order.contact || "";
    customerDepartment = order.customer_department || "";
    designer = order.designer || "";
    paymentStatus = order.payment_status || "未结款";
    status = order.status || "制作中";
    createdBy = order.created_by || creatorName;
    specification = order.specification || "";
    note = order.note || "";
    products = order.products?.length ? order.products : [{ name: order.service_name, quantity: order.quantity, unit: order.unit, unit_price: Number(order.quote_amount || 0) / 100 / Number(order.quantity || 1), subtotal: Number(order.quote_amount || 0) / 100, specification: order.specification || "" }];
    costs = order.costs || [];
    advances = order.advances || [];
    detailOrder = null;
    view = "entry";
  }
  function addProduct() { products = [...products, { name: "", quantity: 1, unit: "项", unit_price: 0, cost_unit: 0, subtotal: 0, specification: "" }]; }
  function removeProduct(index: number) { products = products.filter((_, i) => i !== index); }
  function updateProduct(index: number, key: string, value: unknown) {
    // 手动修改名称意味着不再对应库内条目，取消匹配状态与随库价格
    if (key === "name" && products[index]?.catalog_id) products[index] = { ...products[index], catalog_id: undefined };
    products[index] = { ...products[index], [key]: value };
    products = [...products];
  }
  function findCatalogItem(name: string) {
    const keyword = name.trim().toLowerCase();
    if (!keyword) return undefined;
    const matches = catalog.filter((item) => {
      const text = item.name.toLowerCase();
      const customerMatch = !item.customer_name || item.customer_name === selectedCustomer;
      const projectMatch = !item.project_name || item.project_name === selectedProject;
      return item.quote_unit > 0 && customerMatch && projectMatch && (text === keyword || text.includes(keyword) || keyword.includes(text));
    });
    return matches.sort((a, b) => (a.name.toLowerCase() === keyword ? -1 : 0) - (b.name.toLowerCase() === keyword ? -1 : 0))[0];
  }
  function applyProductCatalog(index: number, name: string) {
    const item = findCatalogItem(name);
    if (!item) { updateProduct(index, "name", name); return; }
    products[index] = { ...products[index], name: item.name, unit: item.unit, unit_price: (item.quote_unit / 100).toFixed(2), cost_unit: (item.cost_unit / 100).toFixed(2), specification: item.specification || "", catalog_id: item.id };
    products = [...products];
  }
  function addCost() { costs = [...costs, { name: "", vendor: "手工录入", unit: "项", quantity: 1, unit_price: 0, subtotal: 0 }]; }
  function removeCost(index: number) { costs = costs.filter((_, i) => i !== index); }
  function updateCost(index: number, key: string, value: unknown) {
    if (key === "name" && costs[index]?.catalog_id) costs[index] = { ...costs[index], catalog_id: undefined };
    costs[index] = { ...costs[index], [key]: value };
    costs = [...costs];
  }
  function applyCostCatalog(index: number, name: string) {
    const keyword = name.trim().toLowerCase();
    let found: { item: Catalog; vendor: string } | undefined;
    for (const item of catalog) {
      const raw = (item.raw_data ? (() => { try { return JSON.parse(item.raw_data as string); } catch { return {}; } })() : {}) as Record<string, unknown>;
      const vendor = String(raw.vendor || raw.supplier || item.supplier_remark || (item.source_type === "supplier_cost" ? (item as any).source_file?.match(/硕达|印客邦|[^】]+(?=202\d)/)?.[0] || "成本库" : ""));
      const isCost = item.cost_unit > 0 && (!item.quote_unit || item.source_type === "supplier_cost");
      if (isCost && (item.name.toLowerCase() === keyword || item.name.toLowerCase().includes(keyword) || keyword.includes(item.name.toLowerCase()))) { found = { item, vendor }; break; }
    }
    if (found) { costs[index] = { ...costs[index], name: found.item.name, vendor: found.vendor || "成本库", unit: found.item.unit, unit_price: (found.item.cost_unit / 100).toFixed(2), catalog_id: found.item.id }; costs = [...costs]; }
    else updateCost(index, "name", name);
  }
  function addAdvance() { advances = [...advances, { id: crypto.randomUUID(), employee: designer || createdBy, item: "", amount: 0, date: orderDate, invoice: "", status: "待审核", invoiceFile: null as File | null }]; }
  function removeAdvance(index: number) { advances = advances.filter((_, i) => i !== index); }
  function updateAdvance(index: number, key: string, value: unknown) { advances[index] = { ...advances[index], [key]: value }; advances = [...advances]; }
  function startNewOrder() { editingOrderId = ""; detailOrder = null; products = [{ name: "", quantity: 1, unit: "项", unit_price: 0, cost_unit: 0, subtotal: 0, specification: "" }]; costs = []; advances = []; serviceName = ""; view = "entry"; }
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
  function toggleOrderColumn(key: string) {
    visibleOrderColumns = visibleOrderColumns.includes(key)
      ? visibleOrderColumns.filter((item) => item !== key)
      : [...visibleOrderColumns, key];
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
  Object.defineProperty(desk, "deliveryDate", { get: () => deliveryDate, set: (value) => { deliveryDate = value; } });
  Object.defineProperty(desk, "contact", { get: () => contact, set: (value) => { contact = value; } });
  Object.defineProperty(desk, "customerDepartment", { get: () => customerDepartment, set: (value) => { customerDepartment = value; } });
  Object.defineProperty(desk, "designer", { get: () => designer, set: (value) => { designer = value; } });
  Object.defineProperty(desk, "paymentStatus", { get: () => paymentStatus, set: (value) => { paymentStatus = value; } });
  Object.defineProperty(desk, "status", { get: () => status, set: (value) => { status = value; } });
  Object.defineProperty(desk, "editingOrderId", { get: () => editingOrderId });
  Object.defineProperty(desk, "products", { get: () => products, set: (value) => { products = value; } });
  Object.defineProperty(desk, "costs", { get: () => costs, set: (value) => { costs = value; } });
  Object.defineProperty(desk, "advances", { get: () => advances, set: (value) => { advances = value; } });
  Object.defineProperty(desk, "detailOrder", { get: () => detailOrder, set: (value) => { detailOrder = value; } });
  Object.defineProperty(desk, "detailAttachments", { get: () => detailAttachments });
  Object.defineProperty(desk, "detailAttachmentsLoading", { get: () => detailAttachmentsLoading });
  Object.defineProperty(desk, "uploadingFiles", { get: () => uploadingFiles, set: (value) => { uploadingFiles = value; } });
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
  Object.defineProperty(desk, "filterDesigner", { get: () => filterDesigner, set: (value) => { filterDesigner = value; } });
  Object.defineProperty(desk, "filterCreator", { get: () => filterCreator, set: (value) => { filterCreator = value; } });
  Object.defineProperty(desk, "filterPayment", { get: () => filterPayment, set: (value) => { filterPayment = value; } });
  Object.defineProperty(desk, "filterFrom", { get: () => filterFrom, set: (value) => { filterFrom = value; } });
  Object.defineProperty(desk, "filterTo", { get: () => filterTo, set: (value) => { filterTo = value; } });
  Object.defineProperty(desk, "orderSort", { get: () => orderSort, set: (value) => { orderSort = value; } });
  Object.defineProperty(desk, "submitMode", { get: () => submitMode, set: (value) => { submitMode = value; } });
  Object.defineProperty(desk, "submitMenuOpen", { get: () => submitMenuOpen, set: (value) => { submitMenuOpen = value; } });
  Object.defineProperty(desk, "showExport", { get: () => showExport, set: (value) => { showExport = value; } });
  Object.defineProperty(desk, "showOrderFilters", { get: () => showOrderFilters, set: (value) => { showOrderFilters = value; } });
  Object.defineProperty(desk, "selectedOrderIds", { get: () => selectedOrderIds, set: (value) => { selectedOrderIds = value; } });
  Object.defineProperty(desk, "selectedColumns", { get: () => selectedColumns, set: (value) => { selectedColumns = value; } });
  Object.defineProperty(desk, "visibleOrderColumns", { get: () => visibleOrderColumns });
  desk.orderColumnOptions = orderColumnOptions;
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
  Object.defineProperty(desk, "totalAdvance", { get: () => totalAdvance });
  Object.defineProperty(desk, "totalUnpaid", { get: () => totalUnpaid });
  Object.defineProperty(desk, "owners", { get: () => owners });
  Object.defineProperty(desk, "designers", { get: () => designers });
  Object.defineProperty(desk, "reimbursementPeople", { get: () => reimbursementPeople });
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
  desk.toggleOrderColumn = toggleOrderColumn;
  desk.resetOrderFilters = resetOrderFilters;
  desk.deleteOrder = deleteOrder;
  desk.openDetail = openDetail;
  desk.fetchAttachments = async (orderId: string) => {
    const result = await api.get<{ data: Array<Record<string, any>> }>(
      `/api/orders/${encodeURIComponent(orderId)}/attachments`,
    );
    return result.data;
  };
  desk.fetchAdvanceAttachments = async (orderId: string, advanceId: string) => {
    const result = await api.get<{ data: Array<Record<string, any>> }>(
      `/api/orders/${encodeURIComponent(orderId)}/attachments?advance_id=${encodeURIComponent(advanceId)}`,
    );
    return result.data;
  };
  desk.removeNoteFile = removeNoteFile;
  desk.onAdvanceInvoiceChange = onAdvanceInvoiceChange;
  desk.removeAdvanceInvoice = removeAdvanceInvoice;
  desk.onNoteFilesChange = onNoteFilesChange;
  desk.attachmentUrl = attachmentUrl;
  desk.formatFileSize = formatFileSize;
  desk.editOrder = editOrder;
  desk.startNewOrder = startNewOrder;
  desk.addProduct = addProduct;
  desk.removeProduct = removeProduct;
  desk.updateProduct = updateProduct;
  desk.applyProductCatalog = applyProductCatalog;
  desk.addCost = addCost;
  desk.removeCost = removeCost;
  desk.updateCost = updateCost;
  desk.applyCostCatalog = applyCostCatalog;
  desk.addAdvance = addAdvance;
  desk.removeAdvance = removeAdvance;
  desk.updateAdvance = updateAdvance;
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
