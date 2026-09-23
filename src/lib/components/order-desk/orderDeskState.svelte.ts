import { onMount } from "svelte";
import { pushState, replaceState } from "$app/navigation";
import type * as XLSXType from "xlsx";
import type { PublicArtifactVisitor } from "$lib/artifact-visitor";
import { api, appPath, currentAppPath } from "$lib/api";

const apiFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(typeof input === "string" ? appPath(input) : input, init);

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
    source_id?: string;
    library_kind?: "quote" | "cost";
    source_owner?: string;
    source_file?: string;
    library_file?: string;
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
    planner?: string;
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

const ARTIFACT_GATEWAY_HOSTS = new Set(["artifact.catsco.cc", "artifact.catsco.cn"]);
function isArtifactGatewayHost(): boolean {
  return typeof window !== "undefined" && ARTIFACT_GATEWAY_HOSTS.has(window.location.hostname);
}

export type Data = {
    customers: Customer[];
    projects: Project[];
    catalog: Catalog[];
    catalogSources: Array<Record<string, any>>;
    orders: Order[];
    reimbursements: Reimbursement[];
    visitor: PublicArtifactVisitor;
  };


export function createOrderDesk(data: Data) {
  let view = $state<"overview" | "entry" | "catalog" | "finance">("overview");
  let workMode = $state<"view" | "entry" | "finance">("view");
  let sidebarCollapsed = $state(false);
  let isEmbedded = $state(false);
  let onArtifactGateway = $state(false);
  let customers = $state(data.customers);
  let projects = $state(data.projects);
  let catalog = $state(data.catalog);
  let catalogSources = $state(data.catalogSources);
  let orders = $state(data.orders);
  let reimbursements = $state(data.reimbursements);
  let customerId = $state("");
  let projectId = $state("");
  let orderDate = $state(new Date().toISOString().slice(0, 10));
  let createdBy = $state("");
  let note = $state("");
  let noteFiles = $state<File[]>([]);
  let deliveryDate = $state("");
  let contact = $state("");
  let customerDepartment = $state("");
  let designer = $state("");
  let planner = $state("");
  let executionCompany = $state("");
  let paymentStatus = $state("未结款");
  let status = $state("制作中");
  let products = $state<Array<Record<string, any>>>([]);
  let costs = $state<Array<Record<string, any>>>([]);
  let advances = $state<Array<Record<string, any>>>([]);
  let editingOrderId = $state("");
  let submissionKey = $state("");
  let orderFormDirty = $state(false);
  let detailOrder = $state<any>(null);
  let detailAttachments = $state<any[]>([]);
  let detailAttachmentsLoading = $state(false);
  let attachmentPreviewOpen = $state(false);
  let attachmentPreviewLoading = $state(false);
  let attachmentPreviewError = $state("");
  let attachmentPreviewUrl = $state("");
  let attachmentPreviewName = $state("");
  let attachmentPreviewMime = $state("");
  let attachmentPreviewRequest = 0;
  let uploadingFiles = $state(false);
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
  let reimbursementRole = $state<"employee" | "finance">("employee");
  let reimbursementProject = $state("");
  let reimbursementPerson = $state("");
  let reimbursementType = $state<"" | "order" | "internal">("");
  let reimbursementStatus = $state("");
  let reimbursementFrom = $state("");
  let reimbursementTo = $state("");
  let search = $state("");
  let catalogSearch = $state("");
  let catalogKind = $state<"quote" | "cost">("quote");
  let catalogPage = $state(1);
  const catalogPageSize = 20;
  let catalogSourceId = $state("");
  let catalogCategory = $state("");
  let catalogImportPreview = $state<any>(null);
  let catalogImportFile = $state<File | null>(null);
  let catalogImportOwner = $state("");
  let catalogSourceOpen = $state(false);
  let catalogSourceName = $state("");
  let catalogSourceCopyId = $state("");
  let reimbursementRejectOpen = $state(false);
  let reimbursementRejectReason = $state("");
  let reimbursementRejectIds = $state<string[]>([]);
  let confirmOpen = $state(false);
  let confirmTitle = $state("");
  let confirmMessage = $state("");
  let confirmAction = $state<null | (() => Promise<void>)>(null);
  let filterCustomer = $state("");
  let filterProject = $state("");
  let filterOwner = $state("");
  let filterDesigner = $state("");
  let filterCreator = $state("");
  let filterPayment = $state("");
  let filterFrom = $state("");
  let filterTo = $state("");
  let orderSort = $state("date_desc");
  let orderPage = $state(1);
  const orderPageSize = 20;
  let showExport = $state(false);
  let exportMode = $state<"detail" | "settlement">("detail");
  let exportTitle = $state("");
  let exportContract = $state("");
  let exportPartyA = $state("");
  let exportPartyB = $state("");
  let exportFollowA = $state("");
  let exportFollowB = $state("");
  let exportContactPhone = $state("");
  let exportRemarkOrder = $state(true);
  let exportExpand = $state(true);
  let exportTotal = $state(true);
  let exportSign = $state(true);
  let showOrderFilters = $state(false);
  let showStandaloneReimbursement = $state(false);
  let selectedReimbursementIds = $state<string[]>([]);
  let standaloneEmployee = $state("");
  let standaloneItem = $state("");
  let standaloneAmount = $state("");
  let standaloneDate = $state(new Date().toISOString().slice(0, 10));
  let standaloneOrderId = $state("");
  let standaloneInvoice = $state("");
  let standaloneInvoiceFile = $state<File | null>(null);
  let standaloneNote = $state("");
  let selectedOrderIds = $state<string[]>([]);
  let visibleOrderColumns = $state(["owner", "quote", "cost", "date", "payment", "status"]);
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
    ["advance_amount", "员工垫付"],
    ["profit", "预计毛利"],
    ["product_name", "产品名称"],
    ["product_specification", "制作要求"],
    ["product_quantity", "产品数量"],
    ["product_unit", "产品单位"],
    ["product_unit_price", "产品单价"],
    ["product_subtotal", "产品小计"],
    ["created_by", "录入人"],
    ["status", "状态"],
    ["note", "备注"],
    ["reimbursement_status", "报销状态"],
  ];
  const loadXlsx = () => import("xlsx") as Promise<typeof XLSXType>;
  const money = (c: number) =>
    `¥${(c / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}`;
  const formatFileSize = (size: number) =>
    size >= 1024 * 1024
      ? `${(size / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(Math.round(size / 1024), 1)} KB`;
  const attachmentUrl = (id: string) => `/api/attachments/${encodeURIComponent(id)}`;
  const reimbursementAttachmentUrl = (id: string) => `/api/reimbursement-attachments/${encodeURIComponent(id)}`;
  const filteredProjects = $derived(
    projects.filter((p) => !customerId || p.customer_id === customerId),
  );
  const visibleCatalog = $derived(
    catalog.filter(
      (item) =>
        (!item.library_kind || item.library_kind === catalogKind) &&
        (!catalogSourceId || item.source_id === catalogSourceId) &&
        (!catalogSearch ||
          `${item.name} ${item.category} ${item.customer_name || ""} ${item.project_name || ""}`
            .toLowerCase()
            .includes(catalogSearch.toLowerCase())) &&
        (!catalogCategory || item.category === catalogCategory),
    ),
  );
  const catalogCategories = $derived([
    ...new Set(
      catalog
        .filter((item) => !item.library_kind || item.library_kind === catalogKind)
        .map((item) => item.category)
        .filter(Boolean),
    ),
  ]);
  const catalogPageCount = $derived(Math.max(1, Math.ceil(visibleCatalog.length / catalogPageSize)));
  const pagedCatalog = $derived(
    visibleCatalog.slice((catalogPage - 1) * catalogPageSize, catalogPage * catalogPageSize),
  );
  $effect(() => {
    visibleCatalog.length;
    catalogSearch;
    catalogKind;
    catalogSourceId;
    catalogCategory;
    catalogPage = 1;
  });
  function setCatalogPage(page: number) {
    catalogPage = Math.min(Math.max(page, 1), catalogPageCount);
  }
  const selectedCustomer = $derived(
    customers.find((item) => item.id === customerId)?.name || "",
  );
  const selectedProject = $derived(
    projects.find((item) => item.id === projectId)?.name || "",
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
  function onFilterCustomerChange() {
    if (
      filterProject &&
      !projects.some(
        (project) =>
          project.id === filterProject &&
          (!filterCustomer || project.customer_id === filterCustomer),
      )
    ) filterProject = "";
  }
  const orderPageCount = $derived(Math.max(1, Math.ceil(filteredOrders.length / orderPageSize)));
  const pagedOrders = $derived(
    filteredOrders.slice((orderPage - 1) * orderPageSize, orderPage * orderPageSize),
  );
  $effect(() => {
    filteredOrders.length;
    search;
    filterCustomer;
    filterProject;
    filterOwner;
    filterDesigner;
    filterCreator;
    filterPayment;
    filterFrom;
    filterTo;
    orderSort;
    orderPage = 1;
  });
  function setOrderPage(page: number) {
    orderPage = Math.min(Math.max(page, 1), orderPageCount);
  }
  const projectStats = $derived(
    customers.map((customer) => {
      const items = filteredOrders.filter((order) => order.customer_id === customer.id);
      return {
        ...customer,
        orderCount: items.length,
        quote: items.reduce((sum, item) => sum + item.quote_amount, 0),
        cost: items.reduce((sum, item) => sum + item.cost_amount, 0),
        advance: items.reduce((sum, item) => sum + (item.advances || []).reduce((subtotal, advance) => subtotal + Math.round(Number(advance.amount || 0) * 100), 0), 0),
      };
    }).filter((customer) => customer.orderCount > 0),
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
  const reimbursementRowsForRole = $derived(
    reimbursements.filter((item: any) =>
      reimbursementRole === "finance" || (creatorName !== "" && item.employee === creatorName),
    ),
  );
  const reimbursementSummaryRows = $derived(
    reimbursementRowsForRole.filter((item: any) =>
      (reimbursementRole !== "finance" || !reimbursementProject || item.project_id === reimbursementProject) &&
      (reimbursementRole !== "finance" || !reimbursementType || (reimbursementType === "order" ? !!item.order_id : !item.order_id)) &&
      (reimbursementRole !== "finance" || !reimbursementFrom || item.advance_date >= reimbursementFrom) &&
      (reimbursementRole !== "finance" || !reimbursementTo || item.advance_date <= reimbursementTo),
    ),
  );
  const reimbursementStats = $derived({
    total: reimbursementSummaryRows.length,
    pendingReview: reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "待审核").length,
    pendingReviewAmount: reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "待审核").reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0),
    pendingPay: reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "待打款").length,
    paid: reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "已报销").length,
    rejected: reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "已打回").length,
    amount: reimbursementSummaryRows.reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0),
    pendingPayAmount: reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "待打款").reduce((sum: number, item: any) => sum + Number(item.advance_amount || 0), 0),
  });
  const reimbursementPaymentSummary = $derived(
    reimbursementSummaryRows
      .filter((item: any) => item.reimbursement_status === "待打款")
      .reduce((groups: Array<any>, item: any) => {
        const employee = item.employee || "未填写";
        const existing = groups.find((group) => group.employee === employee);
        if (existing) {
          existing.count += 1;
          existing.amount += Number(item.advance_amount || 0);
          existing.ids.push(item.id);
        } else {
          groups.push({ employee, count: 1, amount: Number(item.advance_amount || 0), ids: [item.id] });
        }
        return groups;
      }, [])
      .sort((a, b) => b.amount - a.amount),
  );
  const reimbursementVouchers = $derived(
    reimbursements
      .filter((item: any) => item.voucher_no)
      .map((item: any) => ({ ...item, voucherNo: item.voucher_no })),
  );
  const selectedPendingReviewCount = $derived(
    reimbursements.filter((item: any) => selectedReimbursementIds.includes(item.id) && item.reimbursement_status === "待审核").length,
  );
  const selectedPendingPaymentCount = $derived(
    reimbursements.filter((item: any) => selectedReimbursementIds.includes(item.id) && item.reimbursement_status === "待打款").length,
  );
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
  function askConfirm(title: string, text: string, action: () => Promise<void>) {
    confirmTitle = title;
    confirmMessage = text;
    confirmAction = action;
    confirmOpen = true;
  }
  async function runConfirm() {
    const action = confirmAction;
    confirmOpen = false;
    confirmAction = null;
    if (action) await action();
  }
  onMount(() => {
    isEmbedded = window.top !== window.self;
    onArtifactGateway = isArtifactGatewayHost();
    if (data.visitor.status === "guest" && !isEmbedded && onArtifactGateway) {
      const handshakeKey = "oa-artifact-auth-handshake";
      if (!sessionStorage.getItem(handshakeKey)) {
        sessionStorage.setItem(handshakeKey, "started");
        window.location.assign("/_auth/start");
        return;
      }
    }

    const savedName = localStorage.getItem("oa-creator-name") || "";
    const visitorName = data.visitor.status === "authenticated" ? data.visitor.username : "";
    const initialName = visitorName || savedName;
    const savedMode = localStorage.getItem("oa-work-mode");
    creatorName = initialName;
    creatorNameDraft = initialName;
    createdBy = initialName;
    if (visitorName) localStorage.setItem("oa-creator-name", visitorName);
    if (savedMode === "entry" || savedMode === "finance" || savedMode === "view") {
      workMode = savedMode;
      reimbursementRole = savedMode === "finance" ? "finance" : "employee";
    }
    let restoringHistory = false;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (attachmentPreviewOpen) {
        closeAttachmentPreview();
        return;
      }
      showExport = false;
      showOrderFilters = false;
      showStandaloneReimbursement = false;
      showProjectForm = false;
      settingsOpen = false;
      catalogSourceOpen = false;
      reimbursementRejectOpen = false;
      confirmOpen = false;
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (view !== "entry" || !orderFormDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const popstate = () => {
      if (restoringHistory) {
        restoringHistory = false;
        return;
      }
      if (view === "entry" && orderFormDirty && !window.confirm("订单尚未保存，确定离开当前页面吗？")) {
        restoringHistory = true;
        window.history.go(1);
        return;
      }
      syncViewFromPath();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("popstate", popstate);
    return () => {
      window.removeEventListener("keydown", escape);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("popstate", popstate);
      releaseAttachmentPreviewUrl();
    };
  });
  function releaseAttachmentPreviewUrl() {
    if (attachmentPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl = "";
  }
  function closeAttachmentPreview() {
    attachmentPreviewRequest++;
    releaseAttachmentPreviewUrl();
    attachmentPreviewOpen = false;
    attachmentPreviewLoading = false;
    attachmentPreviewError = "";
    attachmentPreviewName = "";
    attachmentPreviewMime = "";
  }
  async function openAttachmentPreview(url: string, name = "附件", mime = "") {
    const requestId = ++attachmentPreviewRequest;
    releaseAttachmentPreviewUrl();
    attachmentPreviewOpen = true;
    attachmentPreviewLoading = true;
    attachmentPreviewError = "";
    attachmentPreviewName = name || "附件";
    attachmentPreviewMime = mime;
    try {
      const response = await apiFetch(url);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || `附件加载失败（HTTP ${response.status}）`);
      }
      const blob = await response.blob();
      if (requestId !== attachmentPreviewRequest) return;
      attachmentPreviewMime = response.headers.get("content-type")?.split(";")[0] || blob.type || mime || "application/octet-stream";
      attachmentPreviewUrl = URL.createObjectURL(blob);
    } catch (reason) {
      if (requestId !== attachmentPreviewRequest) return;
      attachmentPreviewError = reason instanceof Error ? reason.message : "附件加载失败";
    } finally {
      if (requestId === attachmentPreviewRequest) attachmentPreviewLoading = false;
    }
  }
  function openLocalAttachmentPreview(file: File) {
    attachmentPreviewRequest++;
    releaseAttachmentPreviewUrl();
    attachmentPreviewOpen = true;
    attachmentPreviewLoading = false;
    attachmentPreviewError = "";
    attachmentPreviewName = file.name || "附件";
    attachmentPreviewMime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    attachmentPreviewUrl = URL.createObjectURL(file);
  }
  function saveCreatorName() {
    creatorName = creatorNameDraft.trim();
    createdBy = creatorName;
    if (creatorName) localStorage.setItem("oa-creator-name", creatorName);
    else localStorage.removeItem("oa-creator-name");
    settingsOpen = false;
    notify("填写人名字已保存，将在订单录入时自动填入");
  }
  function removeCreatorName() {
    creatorName = "";
    creatorNameDraft = "";
    createdBy = "";
    localStorage.removeItem("oa-creator-name");
    settingsOpen = false;
    notify("已删除填写人名字");
  }
  function setWorkMode(mode: "view" | "entry" | "finance") {
    if (mode !== workMode && view === "entry" && orderFormDirty) {
      if (!window.confirm("订单尚未保存，确定切换工作模式吗？")) return false;
      orderFormDirty = false;
    }
    workMode = mode;
    reimbursementRole = mode === "finance" ? "finance" : "employee";
    localStorage.setItem("oa-work-mode", mode);
    resetReimbursementFilters();
    if (mode !== "entry" && view === "entry") navigate("/orders");
    notify(`已切换到${mode === "finance" ? "财务" : mode === "entry" ? "填写" : "查看"}模式`);
    return true;
  }
  function openSettings() {
    creatorNameDraft = creatorName;
    settingsOpen = true;
  }
  function onCustomerChange() {
    projectId = "";
  }
  function navigate(path: string) {
    if (view === "entry" && orderFormDirty && !window.confirm("订单尚未保存，确定离开当前页面吗？")) return;
    orderFormDirty = false;
    if (currentAppPath() !== path) pushState(appPath(path), {});
    syncViewFromPath();
  }
  function syncViewFromPath() {
    const path = currentAppPath();
    const editMatch = path.match(/^\/orders\/([^/]+)\/edit$/);
    const detailMatch = path.match(/^\/orders\/([^/]+)$/);
    if (path === "/orders/new") {
      if (workMode === "entry") startNewOrder();
      else navigate("/orders");
      return;
    }
    if (editMatch && workMode === "entry") {
      const order = orders.find((item) => item.id === decodeURIComponent(editMatch[1]));
      if (order) editOrder(order, false);
      return;
    }
    if (detailMatch) {
      const order = orders.find((item) => item.id === decodeURIComponent(detailMatch[1]));
      if (order) openDetail(order, false);
      return;
    }
    detailOrder = null;
    editingOrderId = "";
    orderFormDirty = false;
    if (path === "/reimbursements") view = "finance";
    else if (path === "/catalog") view = "catalog";
    else view = "overview";
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
    const sources = await api.get<{ data: Array<Record<string, any>> }>("/api/catalog/sources");
    catalogSources = sources.data;
    reimbursements = r.data;
  }
  function openStandaloneReimbursement() {
    if (workMode !== "finance" && !creatorName) {
      notify("请先设置填写人，再提交本人报销", true);
      openSettings();
      return;
    }
    standaloneEmployee = workMode === "finance" ? "" : creatorName;
    standaloneItem = "";
    standaloneAmount = "";
    standaloneDate = new Date().toISOString().slice(0, 10);
    standaloneOrderId = "";
    standaloneInvoice = "";
    standaloneInvoiceFile = null;
    standaloneNote = "";
    showStandaloneReimbursement = true;
  }
  async function submitStandaloneReimbursement() {
    if (!standaloneEmployee.trim() || !standaloneItem.trim() || !(Number(standaloneAmount) > 0)) {
      notify("请填写报销人、报销物品和大于 0 的金额", true);
      return;
    }
    busy = true;
    let createdId = "";
    try {
      const result = await api.post<{ data: { id: string } }>("/api/reimbursements", { employee: standaloneEmployee, item: standaloneItem, amount: standaloneAmount, advance_date: standaloneDate, order_id: standaloneOrderId, invoice: standaloneInvoice, note: standaloneNote });
      createdId = result.data.id;
      if (standaloneInvoiceFile) {
        const form = new FormData();
        form.append("file", standaloneInvoiceFile);
        const response = await apiFetch(`/api/reimbursements/${encodeURIComponent(result.data.id)}/attachments`, { method: "POST", body: form });
        if (!response.ok) throw new Error((await response.json()).message || "发票上传失败");
      }
      await refresh();
      showStandaloneReimbursement = false;
      if (workMode === "entry" && !creatorName) {
        creatorName = standaloneEmployee.trim();
        creatorNameDraft = creatorName;
        createdBy = creatorName;
        localStorage.setItem("oa-creator-name", creatorName);
      }
      notify("报销记录已保存，等待审核");
    } catch (e) {
      if (createdId) await api.delete(`/api/reimbursements/${encodeURIComponent(createdId)}`).catch(() => undefined);
      notify(e instanceof Error ? e.message : "报销保存失败", true);
    } finally { busy = false; }
  }
  function onStandaloneInvoiceChange(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) && file.type !== "application/pdf") { notify("发票仅支持图片或 PDF 文件", true); return; }
    if (file.size > 10 * 1024 * 1024) { notify("发票文件不能超过 10MB", true); return; }
    standaloneInvoice = file.name;
    standaloneInvoiceFile = file;
  }
  function reimbursementStatusMatches(item: any, statusFilter: string, defaultPending = false) {
    if (statusFilter === "未报销") return item.reimbursement_status !== "已报销";
    if (statusFilter) return item.reimbursement_status === statusFilter;
    return !defaultPending || item.reimbursement_status === "待审核" || item.reimbursement_status === "已打回";
  }
  function filteredReimbursementRows(requireFinancePerson: boolean, defaultPending: boolean) {
    if (requireFinancePerson && reimbursementRole === "finance" && !reimbursementPerson) return [];
    return reimbursementRowsForRole.filter((item: any) =>
      (reimbursementRole !== "finance" || !reimbursementPerson || item.employee === reimbursementPerson) &&
      (!reimbursementProject || item.project_id === reimbursementProject) &&
      (!reimbursementType || (reimbursementType === "order" ? !!item.order_id : !item.order_id)) &&
      reimbursementStatusMatches(item, reimbursementStatus, defaultPending && reimbursementRole === "finance") &&
      (!reimbursementFrom || item.advance_date >= reimbursementFrom) &&
      (!reimbursementTo || item.advance_date <= reimbursementTo),
    );
  }
  function reimbursementRows() {
    return filteredReimbursementRows(false, true);
  }
  function reimbursementExportRows() {
    return filteredReimbursementRows(false, false);
  }
  function resetReimbursementFilters() {
    reimbursementProject = "";
    reimbursementPerson = "";
    reimbursementType = "";
    reimbursementStatus = "";
    reimbursementFrom = "";
    reimbursementTo = "";
    selectedReimbursementIds = [];
  }
  async function batchUpdateReimbursements(ids: string[], status: string, rejectReason = "") {
    const response = await apiFetch("/api/reimbursements/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status, reject_reason: rejectReason, actor: creatorName || "财务人员" }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error?.message || body.detail || body.message || "批量更新失败");
    }
    return (await response.json()).data as Array<any>;
  }
  async function batchReviewReimbursements() {
    const targets = reimbursementRows().filter((item: any) => selectedReimbursementIds.includes(item.id) && item.reimbursement_status === "待审核");
    if (!targets.length) { notify("请选择待审核记录", true); return; }
    busy = true;
    try {
      await batchUpdateReimbursements(targets.map((item) => item.id), "待打款");
      selectedReimbursementIds = selectedReimbursementIds.filter((id) => !targets.some((item) => item.id === id));
      await refresh();
      notify(`已审核通过 ${targets.length} 条报销，进入待打款队列`);
    } catch (e) { notify(e instanceof Error ? e.message : "批量审核失败", true); }
    finally { busy = false; }
  }
  async function exportReimbursements() {
    const rows = reimbursementExportRows();
    if (!rows.length) { notify("当前筛选没有可导出的报销记录", true); return; }
    const params = new URLSearchParams({ mode: "detail" });
    if (reimbursementProject) params.set("project", reimbursementProject);
    if (reimbursementPerson) params.set("person", reimbursementPerson);
    if (reimbursementType) params.set("type", reimbursementType);
    if (reimbursementStatus) params.set("status", reimbursementStatus);
    if (reimbursementFrom) params.set("from", reimbursementFrom);
    if (reimbursementTo) params.set("to", reimbursementTo);
    params.set("actor", creatorName || "财务人员");
    window.location.href = appPath(`/api/reimbursements/export?${params}`);
    notify(`正在导出 ${rows.length} 条报销记录`);
  }
  function batchMarkReimbursed() {
    const targets = reimbursements.filter((item: any) => selectedReimbursementIds.includes(item.id) && item.reimbursement_status === "待打款");
    if (!targets.length) { notify("请选择待打款记录", true); return; }
    const total = targets.reduce((sum, item: any) => sum + Number(item.advance_amount || 0), 0);
    askConfirm("确认批量打款", `确认将 ${targets.length} 笔、合计 ${money(total)} 标记为已报销？此状态不能直接撤回。`, async () => {
      busy = true;
      try {
        await batchUpdateReimbursements(targets.map((item) => item.id), "已报销");
        selectedReimbursementIds = selectedReimbursementIds.filter((id) => !targets.some((item) => item.id === id));
        await refresh();
        notify(`已标记 ${targets.length} 条报销记录为已报销`);
      } catch (e) { notify(e instanceof Error ? e.message : "批量处理失败", true); }
      finally { busy = false; }
    });
  }
  async function exportPaymentSummary() {
    const rows = reimbursementSummaryRows.filter((item: any) => item.reimbursement_status === "待打款");
    if (!rows.length) { notify("当前筛选暂无待付款记录", true); return; }
    const params = new URLSearchParams({ mode: "payment", actor: creatorName || "财务人员" });
    if (reimbursementProject) params.set("project", reimbursementProject);
    if (reimbursementType) params.set("type", reimbursementType);
    if (reimbursementFrom) params.set("from", reimbursementFrom);
    if (reimbursementTo) params.set("to", reimbursementTo);
    window.location.href = appPath(`/api/reimbursements/export?${params}`);
    notify(`正在导出 ${rows.length} 条待付款记录`);
  }
  function selectEmployeePayments(employee: string) {
    const targets = reimbursementSummaryRows
      .filter((item: any) => item.employee === employee && item.reimbursement_status === "待打款")
      .map((item: any) => item.id);
    const allSelected = targets.length > 0 && targets.every((id: string) => selectedReimbursementIds.includes(id));
    selectedReimbursementIds = allSelected
      ? selectedReimbursementIds.filter((id) => !targets.includes(id))
      : [...new Set([...selectedReimbursementIds, ...targets])];
  }
  function markEmployeeReimbursed(employee: string) {
    const targets = reimbursementSummaryRows.filter((item: any) => item.employee === employee && item.reimbursement_status === "待打款");
    if (!targets.length) { notify("该员工暂无待付款报销", true); return; }
    const total = targets.reduce((sum, item: any) => sum + Number(item.advance_amount || 0), 0);
    askConfirm("确认已打款", `确认已向 ${employee} 支付 ${targets.length} 笔、合计 ${money(total)}？此状态不能直接撤回。`, async () => {
      busy = true;
      try {
        await batchUpdateReimbursements(targets.map((item) => item.id), "已报销");
        selectedReimbursementIds = selectedReimbursementIds.filter((id) => !targets.some((item) => item.id === id));
        await refresh();
        notify(`${employee} 已确认打款`);
      } catch (e) { notify(e instanceof Error ? e.message : "确认打款失败", true); }
      finally { busy = false; }
    });
  }
  async function archiveReimbursementVoucher(item: any) {
    busy = true;
    try {
      const response = await apiFetch(`/api/reimbursements/${encodeURIComponent(item.id)}/archive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor: creatorName || "财务人员" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || payload.message || "归档失败");
      await refresh();
      notify("报销单据已归档");
    } catch (e) { notify(e instanceof Error ? e.message : "归档失败", true); }
    finally { busy = false; }
  }
  async function generateReimbursementVoucher(item: any) {
    busy = true;
    try {
      const response = await apiFetch(`/api/reimbursements/${encodeURIComponent(item.id)}/voucher`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || body.message || "生成单据失败");
      }
      await refresh();
      notify("报销单据已生成");
    } catch (e) { notify(e instanceof Error ? e.message : "生成单据失败", true); }
    finally { busy = false; }
  }
  function rejectReimbursement(item: any) {
    reimbursementRejectIds = [item.id];
    reimbursementRejectReason = item.reject_reason || "";
    reimbursementRejectOpen = true;
  }
  function batchRejectReimbursements() {
    const targets = reimbursementRows().filter((item: any) => selectedReimbursementIds.includes(item.id) && item.reimbursement_status === "待审核");
    if (!targets.length) { notify("请选择待审核记录", true); return; }
    reimbursementRejectIds = targets.map((item: any) => item.id);
    reimbursementRejectReason = "附件不清晰，请重新上传";
    reimbursementRejectOpen = true;
  }
  async function confirmRejectReimbursements() {
    const reason = reimbursementRejectReason.trim();
    if (!reason) { notify("请填写员工可见的打回原因", true); return; }
    const ids = [...reimbursementRejectIds];
    busy = true;
    try {
      await batchUpdateReimbursements(ids, "已打回", reason);
      selectedReimbursementIds = selectedReimbursementIds.filter((id) => !ids.includes(id));
      reimbursementRejectOpen = false;
      reimbursementRejectIds = [];
      await refresh();
      notify(ids.length > 1 ? `已打回 ${ids.length} 条报销` : "报销已打回，员工可查看原因并重新上传发票");
    } catch (e) { notify(e instanceof Error ? e.message : "打回失败", true); }
    finally { busy = false; }
  }
  async function reuploadReimbursement(item: any) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { notify("发票文件不能超过 10MB", true); return; }
      busy = true;
      try {
        const form = new FormData(); form.append("file", file, file.name);
        const response = await apiFetch(`/api/reimbursements/${encodeURIComponent(item.id)}/attachments`, { method: "POST", body: form });
        if (!response.ok) throw new Error((await response.json()).message || "发票上传失败");
        await refresh();
        notify("发票已重新上传，等待财务核验");
      } catch (e) { notify(e instanceof Error ? e.message : "发票上传失败", true); }
      finally { busy = false; }
    };
    input.click();
  }
  function toggleReimbursement(id: string) {
    selectedReimbursementIds = selectedReimbursementIds.includes(id) ? selectedReimbursementIds.filter((item) => item !== id) : [...selectedReimbursementIds, id];
  }
  function deleteReimbursement(item: any) {
    askConfirm("删除报销", `确认删除报销“${item.advance_item || item.item}”？此操作不可恢复。`, async () => {
      busy = true;
      try {
        await api.delete(`/api/reimbursements/${encodeURIComponent(item.id)}`);
        selectedReimbursementIds = selectedReimbursementIds.filter((id) => id !== item.id);
        await refresh();
        notify("报销记录已删除");
      } catch (e) { notify(e instanceof Error ? e.message : "报销删除失败", true); }
      finally { busy = false; }
    });
  }
  async function updateReimbursementStatus(item: Reimbursement, status: string) {
    busy = true;
    try {
      const response = await apiFetch(`/api/reimbursements/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, actor: "财务人员" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error?.message || payload.message || "状态更新失败");
      }
      await refresh();
      notify(status === "已报销" ? "已标记为已报销" : status === "待打款" ? "报销已审核通过，进入待打款队列" : "已更新报销状态");
    } catch (e) {
      notify(e instanceof Error ? e.message : "状态更新失败", true);
    } finally {
      busy = false;
    }
  }
  function markReimbursement(item: Reimbursement, status: string) {
    if (status !== "已报销") {
      void updateReimbursementStatus(item, status);
      return;
    }
    askConfirm("确认已打款", `确认将“${(item as any).advance_item || item.service_name}”的 ${money(Number((item as any).advance_amount || 0))} 标记为已报销？`, () => updateReimbursementStatus(item, status));
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
    if (kept.length) orderFormDirty = true;
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
    orderFormDirty = true;
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
    orderFormDirty = true;
    notify("发票已选择，保存订单时上传");
  }
  function removeAdvanceInvoice(index: number) {
    advances[index] = { ...advances[index], invoice: "", invoiceFile: null };
    advances = [...advances];
    orderFormDirty = true;
  }
  async function uploadAttachments(orderId: string, savedAdvances: Array<Record<string, any>>, submittedAdvances: Array<Record<string, any>>) {
    const savedById = new Map(savedAdvances.map((advance) => [String(advance.id), advance]));
    const invoices = submittedAdvances.map((advance, index) => ({
      file: advance.invoiceFile as File | null,
      submittedId: String(advance.id || ""),
      reimbursementId: savedById.get(String(advance.id))?.id || savedAdvances[index]?.id,
    })).filter((item): item is { file: File; submittedId: string; reimbursementId: string } => item.file instanceof File && Boolean(item.reimbursementId));
    if (!noteFiles.length && !invoices.length) return;
    uploadingFiles = true;
    const failures: string[] = [];
    try {
      for (const file of [...noteFiles]) {
        try {
          await postOrderAttachment(orderId, file);
          noteFiles = noteFiles.filter((item) => item !== file);
        } catch (reason) {
          failures.push(`${file.name}：${reason instanceof Error ? reason.message : "上传失败"}`);
        }
      }
      for (const invoice of invoices) {
        try {
          await postReimbursementAttachment(invoice.reimbursementId, invoice.file);
          const index = advances.findIndex((advance) => String(advance.id || "") === invoice.submittedId);
          if (index >= 0) {
            advances[index] = { ...advances[index], invoiceFile: null };
            advances = [...advances];
          }
        } catch (reason) {
          failures.push(`${invoice.file.name}：${reason instanceof Error ? reason.message : "上传失败"}`);
        }
      }
      if (failures.length) throw new Error(`订单已保存，但以下附件上传失败：${failures.join("；")}`);
    } finally {
      uploadingFiles = false;
    }
  }
  async function postReimbursementAttachment(reimbursementId: string, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await apiFetch(`/api/reimbursements/${encodeURIComponent(reimbursementId)}/attachments`, { method: "POST", body: form });
    if (!response.ok) throw new Error((await response.json()).message || "发票上传失败");
  }
  async function postOrderAttachment(orderId: string, file: File) {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await apiFetch(
      `/api/orders/${encodeURIComponent(orderId)}/attachments`,
      { method: "POST", body: form },
    );
    if (!response.ok) {
      const text = await response.text();
      let detail = `附件上传失败（HTTP ${response.status}）`;
      try {
        const payload = JSON.parse(text);
        detail = payload?.error?.message || payload?.detail || payload?.message || detail;
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
    // 部门、联系人和垫付均是业务补充信息；和 demo 一致，订单的最小可保存单位是产品明细。
    // 空白的动态行会被忽略，但不能用成本或垫付行替代产品行。
    const validProducts = products.filter((item) => hasName(item.name));
    const validCosts = costs.filter((item) => hasName(item.name));
    const validAdvances = advances.filter((item) => hasName(item.item) || Number(item.amount) > 0);
    if (!validProducts.length) {
      notify("请至少添加一项产品", true);
      return;
    }
    busy = true;
    try {
      const payload = { project_id: projectId, order_date: orderDate, delivery_date: deliveryDate, contact, customer_department: customerDepartment, designer, planner, execution_company: executionCompany, payment_status: paymentStatus, status, created_by: createdBy.trim() || creatorName || "未填写", note, products: validProducts, costs: validCosts, advances: validAdvances, idempotency_key: editingOrderId ? "" : (submissionKey ||= crypto.randomUUID()) };
      const result = editingOrderId
        ? await api.patch<{ data: Order }>(`/api/orders/${editingOrderId}`, payload)
        : await api.post<{ data: Order }>("/api/orders", payload);
      await refresh();
      try {
        await uploadAttachments(result.data.id, result.data.advances || [], validAdvances);
      } finally {
        await refresh();
      }
      replaceState(appPath("/orders"), {});
      notify(
        advances.length
          ? "订单已提交报销，已进入报销核验"
          : editingOrderId ? "订单已更新" : "订单已保存",
      );
      view = "overview";
      editingOrderId = "";
      submissionKey = crypto.randomUUID();
      detailOrder = null;
      products = [];
      costs = [];
      advances = [];
      note = "";
      noteFiles = [];
      createdBy = creatorName;
      deliveryDate = "";
      contact = "";
      customerDepartment = "";
      designer = "";
      planner = "";
      executionCompany = "";
      paymentStatus = "未结款";
      orderFormDirty = false;
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
  function requireCatalogManager() {
    if (workMode === "finance") return true;
    notify("报价成本库对所有成员开放查看，仅财务可以新增或导入资料", true);
    return false;
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !requireCatalogManager()) return;
    busy = true;
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("mode", "preview");
      const response = await apiFetch("/api/catalog/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || result.message || "文件解析失败");
      catalogImportFile = file;
      catalogImportOwner = "";
      catalogImportPreview = result.data;
    } catch (e) {
      notify(e instanceof Error ? e.message : "文件解析失败", true);
    } finally { busy = false; }
  }
  function cancelCatalogImport() {
    catalogImportFile = null;
    catalogImportOwner = "";
    catalogImportPreview = null;
  }
  function openCatalogSourceForm() {
    if (!requireCatalogManager()) return;
    catalogSourceName = "";
    catalogSourceCopyId = "";
    catalogSourceOpen = true;
  }
  async function createCatalogSourceFromForm() {
    if (!requireCatalogManager()) return;
    const owner = catalogSourceName.trim();
    if (!owner) {
      notify(`请填写${catalogKind === "quote" ? "客户公司" : "厂商"}名称`, true);
      return;
    }
    busy = true;
    try {
      const result = await api.post<{ data: Record<string, any> }>("/api/catalog/sources", {
        kind: catalogKind,
        owner_name: owner,
        copy_from_id: catalogSourceCopyId,
        source_method: catalogSourceCopyId ? "copy" : "manual",
        actor: creatorName || "财务人员",
      });
      await refresh();
      catalogSourceId = String(result.data.id);
      catalogSourceOpen = false;
      notify(catalogSourceCopyId ? `已新增“${owner}”并沿用现有资料库` : `已新增“${owner}”，可继续上传配置文件`);
    } catch (e) {
      notify(e instanceof Error ? e.message : "资料库来源创建失败", true);
    } finally {
      busy = false;
    }
  }
  async function confirmCatalogImport() {
    if (!requireCatalogManager() || !catalogImportFile || !catalogImportPreview?.valid_rows) return;
    if (catalogSourceId) {
      const source = catalogSources.find((item) => item.id === catalogSourceId);
      if (!window.confirm(`将用新文件替换“${source?.owner_name || "当前资料库"}”的全部有效条目，历史订单不受影响。确定继续吗？`)) return;
    }
    if (!catalogSourceId && !catalogImportOwner.trim()) {
      notify(`请填写${catalogKind === "quote" ? "客户公司" : "厂商"}名称`, true);
      return;
    }
    busy = true;
    try {
      let sourceId = catalogSourceId;
      if (!sourceId) {
        const source = await api.post<{ data: Record<string, any> }>("/api/catalog/sources", { kind: catalogKind, owner_name: catalogImportOwner.trim(), source_file: catalogImportFile.name, source_method: "upload", actor: creatorName || "财务人员" });
        sourceId = String(source.data.id);
        catalogSourceId = sourceId;
      }
      const form = new FormData();
      form.append("file", catalogImportFile, catalogImportFile.name);
      form.append("source_id", sourceId);
      form.append("mode", "import");
      form.append("replace", "true");
      form.append("actor", creatorName || "财务人员");
      const response = await apiFetch("/api/catalog/import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || result.message || "文件导入失败");
      cancelCatalogImport();
      await refresh();
      notify(`已导入 ${result.data.imported} 条报价成本记录${result.data.ignored ? `，忽略 ${result.data.ignored} 条` : ""}`);
    } catch (e) { notify(e instanceof Error ? e.message : "文件导入失败", true); }
    finally { busy = false; }
  }
  function openDetail(order: any, pushHistory = true) {
    if (!order) return;
    if (pushHistory && currentAppPath() !== `/orders/${order.id}`) pushState(appPath(`/orders/${order.id}`), {});
    view = "overview";
    editingOrderId = "";
    orderFormDirty = false;
    detailOrder = order;
    detailAttachments = [];
    loadDetailAttachments(order.id);
  }
  function editOrder(order: any, pushHistory = true) {
    if (pushHistory && currentAppPath() !== `/orders/${order.id}/edit`) pushState(appPath(`/orders/${order.id}/edit`), {});
    editingOrderId = order.id;
    customerId = order.customer_id;
    projectId = order.project_id;
    orderDate = order.order_date;
    deliveryDate = order.delivery_date || "";
    contact = order.contact || "";
    customerDepartment = order.customer_department || "";
    designer = order.designer || "";
    planner = order.planner || "";
    executionCompany = order.execution_company || "";
    paymentStatus = order.payment_status || "未结款";
    status = order.status || "制作中";
    createdBy = order.created_by || creatorName;
    note = order.note || "";
    products = order.products?.length ? order.products : [{ name: order.service_name, quantity: order.quantity, unit: order.unit, unit_price: Number(order.quote_amount || 0) / 100 / Number(order.quantity || 1), subtotal: Number(order.quote_amount || 0) / 100, specification: order.specification || "" }];
    costs = order.costs || [];
    advances = order.advances || [];
    detailOrder = null;
    view = "entry";
    orderFormDirty = false;
  }
  function addProduct() { products = [...products, { name: "", quantity: 1, unit: "项", unit_price: 0, cost_unit: 0, subtotal: 0, specification: "" }]; orderFormDirty = true; }
  function removeProduct(index: number) { products = products.filter((_, i) => i !== index); orderFormDirty = true; }
  function updateProduct(index: number, key: string, value: unknown) {
    // 手动修改名称意味着不再对应库内条目，取消匹配状态与随库价格
    if (key === "name" && products[index]?.catalog_id) products[index] = { ...products[index], catalog_id: undefined };
    products[index] = { ...products[index], [key]: value };
    products = [...products];
    orderFormDirty = true;
  }
  function findCatalogItem(name: string) {
    const keyword = name.trim().toLowerCase();
    if (!keyword) return undefined;
    const matches = catalog.filter((item) => {
      const text = item.name.toLowerCase();
      const customerMatch = !selectedCustomer || !item.customer_name || item.customer_name === selectedCustomer;
      const projectMatch = !selectedProject || !item.project_name || item.project_name === selectedProject;
      return item.quote_unit > 0 && customerMatch && projectMatch && (text === keyword || text.includes(keyword) || keyword.includes(text));
    });
    return matches.sort((a, b) => {
      const aExact = a.name.toLowerCase() === keyword ? 1 : 0;
      const bExact = b.name.toLowerCase() === keyword ? 1 : 0;
      const aContext = (a.customer_name === selectedCustomer ? 2 : 0) + (a.project_name === selectedProject ? 1 : 0);
      const bContext = (b.customer_name === selectedCustomer ? 2 : 0) + (b.project_name === selectedProject ? 1 : 0);
      return bExact - aExact || bContext - aContext;
    })[0];
  }
  function applyProductCatalog(index: number, value: string) {
    const item = catalog.find((entry) => entry.id === value) || findCatalogItem(value);
    if (!item) { updateProduct(index, "name", value); return; }
    products[index] = {
      ...products[index],
      name: item.name,
      unit: item.unit || "项",
      unit_price: (item.quote_unit / 100).toFixed(2),
      cost_unit: (item.cost_unit / 100).toFixed(2),
      specification: item.specification || item.supplier_remark || "",
      catalog_id: item.id,
    };
    products = [...products];
    orderFormDirty = true;
  }
  function matchProductCatalog(index: number) {
    const product = products[index];
    if (!product || product.catalog_id || !String(product.name || "").trim()) return;
    const item = findCatalogItem(String(product.name));
    if (item && item.name.trim().toLowerCase() === String(product.name).trim().toLowerCase()) applyProductCatalog(index, item.id);
  }
  function addCost() { costs = [...costs, { name: "", vendor: "手工录入", unit: "项", quantity: 1, unit_price: 0, subtotal: 0 }]; orderFormDirty = true; }
  function removeCost(index: number) { costs = costs.filter((_, i) => i !== index); orderFormDirty = true; }
  function updateCost(index: number, key: string, value: unknown) {
    if (key === "name" && costs[index]?.catalog_id) costs[index] = { ...costs[index], catalog_id: undefined };
    costs[index] = { ...costs[index], [key]: value };
    costs = [...costs];
    orderFormDirty = true;
  }
  function applyCostCatalog(index: number, value: string) {
    const selected = catalog.find((item) => item.id === value);
    const keyword = (selected?.name || value).trim().toLowerCase();
    let found: { item: Catalog; vendor: string } | undefined;
    for (const item of selected ? [selected] : catalog) {
      const raw = (item.raw_data ? (() => { try { return JSON.parse(item.raw_data as string); } catch { return {}; } })() : {}) as Record<string, unknown>;
      const vendor = String(raw.vendor || raw.supplier || item.source_owner || item.supplier_remark || (item.source_type === "supplier_cost" ? item.source_file?.match(/硕达|印客邦|[^】]+(?=202\d)/)?.[0] || "成本库" : ""));
      const isCost = item.cost_unit > 0 && (!item.quote_unit || item.source_type === "supplier_cost");
      if (isCost && (item.name.toLowerCase() === keyword || item.name.toLowerCase().includes(keyword) || keyword.includes(item.name.toLowerCase()))) { found = { item, vendor }; break; }
    }
    if (found) {
      costs[index] = { ...costs[index], name: found.item.name, vendor: found.vendor || "成本库", unit: found.item.unit, unit_price: (found.item.cost_unit / 100).toFixed(2), catalog_id: found.item.id };
      costs = [...costs];
      orderFormDirty = true;
    } else updateCost(index, "name", value);
  }
  function addAdvance() { advances = [...advances, { id: crypto.randomUUID(), employee: designer || createdBy, item: "", amount: 0, date: orderDate, invoice: "", status: "待审核", invoiceFile: null as File | null }]; orderFormDirty = true; }
  function removeAdvance(index: number) { advances = advances.filter((_, i) => i !== index); orderFormDirty = true; }
  function updateAdvance(index: number, key: string, value: unknown) { advances[index] = { ...advances[index], [key]: value }; advances = [...advances]; orderFormDirty = true; }
  function startNewOrder() {
    editingOrderId = "";
    submissionKey = crypto.randomUUID();
    detailOrder = null;
    customerId = "";
    projectId = "";
    orderDate = new Date().toISOString().slice(0, 10);
    deliveryDate = "";
    contact = "";
    customerDepartment = "";
    designer = "";
    planner = "";
    status = "制作中";
    paymentStatus = "未结款";
    createdBy = creatorName;
    note = "";
    noteFiles = [];
    products = [{ name: "", quantity: 1, unit: "项", unit_price: 0, cost_unit: 0, subtotal: 0, specification: "" }];
    costs = [];
    advances = [{ id: crypto.randomUUID(), employee: createdBy, item: "", amount: 0, date: orderDate, invoice: "", status: "待审核", invoiceFile: null as File | null }];
    view = "entry";
    orderFormDirty = false;
  }
  function canEditAdvance(advance: Record<string, unknown>) {
    return !advance.status || advance.status === "待审核";
  }
  function markOrderDirty() { orderFormDirty = true; }
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
    const first = filteredOrders[0];
    exportTitle = first ? `${first.project_name || first.customer_name || "订单"}结算明细` : "订单结算明细";
    exportPartyA = first?.customer_name || "";
    exportPartyB = "";
    exportContract = "";
    exportFollowA = first?.contact || "";
    exportFollowB = creatorName || "";
    exportContactPhone = "";
    exportRemarkOrder = true;
    exportExpand = true;
    exportTotal = true;
    exportSign = true;
    exportMode = "detail";
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
      mode: exportMode,
      title: exportTitle,
      contract: exportContract,
      partyA: exportPartyA,
      partyB: exportPartyB,
      followA: exportFollowA,
      followB: exportFollowB,
      contactPhone: exportContactPhone,
      remarkOrder: String(exportRemarkOrder),
      expand: String(exportExpand),
      total: String(exportTotal),
      sign: String(exportSign),
      actor: creatorName || "查看模式",
    });
    window.location.href = appPath(`/api/orders/export?${params}`);
    showExport = false;
  }
  async function copyExportTable() {
    const selectedOrders = filteredOrders.filter((order) => selectedOrderIds.includes(order.id));
    if (!selectedOrders.length) {
      notify("请选择要复制的订单", true);
      return;
    }
    const clean = (value: unknown) => String(value ?? "").replace(/[\t\r\n]+/g, " ");
    const advanceAmount = (order: any) => (order.advances || []).reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
    const valueFor = (order: any, key: string, product?: any) => {
      const productsForText = order.products || [];
      const values: Record<string, unknown> = {
        code: order.code, order_date: order.order_date, customer_name: order.customer_name,
        project_name: order.project_name, project_owner: order.project_owner, customer_department: order.customer_department,
        designer: order.designer, contact: order.contact, delivery_date: order.delivery_date,
        payment_status: order.payment_status, service_name: order.service_name, quantity: order.quantity, unit: order.unit,
        quote_amount: Number(order.quote_amount || 0) / 100, cost_amount: Number(order.cost_amount || 0) / 100,
        advance_amount: advanceAmount(order), profit: Number(order.quote_amount || 0) / 100 - Number(order.cost_amount || 0) / 100 - advanceAmount(order),
        created_by: order.created_by, status: order.status, note: order.note, reimbursement_status: order.reimbursement_status,
        product_name: product?.name ?? productsForText.map((item: any) => item.name).join("、"),
        product_specification: product?.specification ?? productsForText.map((item: any) => item.specification).filter(Boolean).join("；"),
        product_quantity: product?.quantity ?? productsForText.map((item: any) => item.quantity).join("、"),
        product_unit: product?.unit ?? productsForText.map((item: any) => item.unit).join("、"),
        product_unit_price: product?.unit_price ?? productsForText.map((item: any) => item.unit_price).join("、"),
        product_subtotal: product ? Number(product.quantity || 0) * Number(product.unit_price || 0) : Number(order.quote_amount || 0) / 100,
      };
      return clean(values[key]);
    };
    let lines: string[][];
    if (exportMode === "settlement") {
      lines = [["分类", "产品名称", "制作要求", "单位", "数量", "单价（元）", "金额（元）", "订单编号", "备注"]];
      for (const order of selectedOrders) for (const product of order.products || []) lines.push([
        product.category || "其他", product.name, product.specification || "", product.unit || "项", product.quantity,
        product.unit_price, Number(product.quantity || 0) * Number(product.unit_price || 0), order.code,
        exportRemarkOrder ? order.code : "",
      ].map(clean));
      if (exportTotal) lines.push(["合计", "", "", "", "", "", selectedOrders.reduce((sum, order) => sum + Number(order.quote_amount || 0) / 100, 0), "", ""].map(clean));
      if (exportSign) lines.push(["甲方（盖章）", "", "", "乙方（盖章）", "", "", "", "", ""]);
    } else {
      const labels = new Map(exportColumns.map(([key, label]) => [key, label]));
      lines = [selectedColumns.map((key) => labels.get(key) || key)];
      for (const order of selectedOrders) {
        const productsToWrite = exportExpand && order.products?.length ? order.products : [undefined];
        for (const product of productsToWrite) lines.push(selectedColumns.map((key) => valueFor(order, key, product)));
      }
      if (exportTotal) {
        const monetaryKeys = new Set(["quote_amount", "cost_amount", "advance_amount", "profit", "product_subtotal"]);
        const labelKey = selectedColumns.find((key) => !monetaryKeys.has(key));
        const quote = selectedOrders.reduce((sum, order) => sum + Number(order.quote_amount || 0) / 100, 0);
        const cost = selectedOrders.reduce((sum, order) => sum + Number(order.cost_amount || 0) / 100, 0);
        const advance = selectedOrders.reduce((sum, order) => sum + advanceAmount(order), 0);
        const totals: Record<string, number> = { quote_amount: quote, cost_amount: cost, advance_amount: advance, profit: quote - cost - advance, product_subtotal: quote };
        lines.push(selectedColumns.map((key) => key === labelKey ? "合计" : key in totals ? clean(totals[key]) : ""));
      }
    }
    const text = lines.map((row) => row.join("\t")).join("\n");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      notify(`已复制 ${lines.length - 1} 行表格，可直接粘贴到 Excel`);
    } catch {
      notify("复制失败，请改用下载 Excel", true);
    }
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
  function deleteOrder(order: Order) {
    askConfirm("删除订单", `确认删除订单“${order.service_name}”（${order.code}）？删除后不可恢复。`, async () => {
      busy = true;
      try {
        await api.delete(`/api/orders/${encodeURIComponent(order.id)}`);
        selectedOrderIds = selectedOrderIds.filter((id) => id !== order.id);
        await refresh();
        notify("订单已删除");
      } catch (e) {
        notify(e instanceof Error ? e.message : "订单删除失败", true);
      } finally { busy = false; }
    });
  }


  const desk = {} as Record<string, any>;
  Object.defineProperty(desk, "view", { get: () => view, set: (value) => { view = value; } });
  Object.defineProperty(desk, "workMode", { get: () => workMode, set: (value) => { setWorkMode(value); } });
  Object.defineProperty(desk, "canWrite", { get: () => workMode === "entry" });
  Object.defineProperty(desk, "canFinance", { get: () => workMode === "finance" });
  Object.defineProperty(desk, "canManageCatalog", { get: () => workMode === "finance" });
  Object.defineProperty(desk, "sidebarCollapsed", { get: () => sidebarCollapsed, set: (value) => { sidebarCollapsed = value; } });
  Object.defineProperty(desk, "visitor", { get: () => data.visitor });
  Object.defineProperty(desk, "isEmbedded", { get: () => isEmbedded });
  Object.defineProperty(desk, "onArtifactGateway", { get: () => onArtifactGateway });
  Object.defineProperty(desk, "customers", { get: () => customers, set: (value) => { customers = value; } });
  Object.defineProperty(desk, "projects", { get: () => projects, set: (value) => { projects = value; } });
  Object.defineProperty(desk, "catalog", { get: () => catalog, set: (value) => { catalog = value; } });
  Object.defineProperty(desk, "catalogSources", { get: () => catalogSources, set: (value) => { catalogSources = value; } });
  Object.defineProperty(desk, "orders", { get: () => orders, set: (value) => { orders = value; } });
  Object.defineProperty(desk, "customerId", { get: () => customerId, set: (value) => { customerId = value; } });
  Object.defineProperty(desk, "projectId", { get: () => projectId, set: (value) => { projectId = value; } });
  Object.defineProperty(desk, "orderDate", { get: () => orderDate, set: (value) => { orderDate = value; } });
  Object.defineProperty(desk, "createdBy", { get: () => createdBy, set: (value) => { createdBy = value; } });
  Object.defineProperty(desk, "note", { get: () => note, set: (value) => { note = value; } });
  Object.defineProperty(desk, "noteFiles", { get: () => noteFiles, set: (value) => { noteFiles = value; } });
  Object.defineProperty(desk, "deliveryDate", { get: () => deliveryDate, set: (value) => { deliveryDate = value; } });
  Object.defineProperty(desk, "contact", { get: () => contact, set: (value) => { contact = value; } });
  Object.defineProperty(desk, "customerDepartment", { get: () => customerDepartment, set: (value) => { customerDepartment = value; } });
  Object.defineProperty(desk, "designer", { get: () => designer, set: (value) => { designer = value; } });
  Object.defineProperty(desk, "planner", { get: () => planner, set: (value) => { planner = value; } });
  Object.defineProperty(desk, "executionCompany", { get: () => executionCompany, set: (value) => { executionCompany = value; } });
  Object.defineProperty(desk, "paymentStatus", { get: () => paymentStatus, set: (value) => { paymentStatus = value; } });
  Object.defineProperty(desk, "status", { get: () => status, set: (value) => { status = value; } });
  Object.defineProperty(desk, "editingOrderId", { get: () => editingOrderId });
  Object.defineProperty(desk, "products", { get: () => products, set: (value) => { products = value; } });
  Object.defineProperty(desk, "costs", { get: () => costs, set: (value) => { costs = value; } });
  Object.defineProperty(desk, "advances", { get: () => advances, set: (value) => { advances = value; } });
  Object.defineProperty(desk, "detailOrder", { get: () => detailOrder, set: (value) => { detailOrder = value; } });
  Object.defineProperty(desk, "detailAttachments", { get: () => detailAttachments });
  Object.defineProperty(desk, "detailAttachmentsLoading", { get: () => detailAttachmentsLoading });
  Object.defineProperty(desk, "attachmentPreviewOpen", { get: () => attachmentPreviewOpen });
  Object.defineProperty(desk, "attachmentPreviewLoading", { get: () => attachmentPreviewLoading });
  Object.defineProperty(desk, "attachmentPreviewError", { get: () => attachmentPreviewError });
  Object.defineProperty(desk, "attachmentPreviewUrl", { get: () => attachmentPreviewUrl });
  Object.defineProperty(desk, "attachmentPreviewName", { get: () => attachmentPreviewName });
  Object.defineProperty(desk, "attachmentPreviewMime", { get: () => attachmentPreviewMime });
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
  Object.defineProperty(desk, "reimbursementRole", { get: () => reimbursementRole });
  Object.defineProperty(desk, "reimbursementProject", { get: () => reimbursementProject, set: (value) => { reimbursementProject = value; selectedReimbursementIds = []; } });
  Object.defineProperty(desk, "reimbursementPerson", { get: () => reimbursementPerson, set: (value) => { reimbursementPerson = value; selectedReimbursementIds = []; } });
  Object.defineProperty(desk, "reimbursementType", { get: () => reimbursementType, set: (value) => { reimbursementType = value; selectedReimbursementIds = []; } });
  Object.defineProperty(desk, "reimbursementStatus", { get: () => reimbursementStatus, set: (value) => { reimbursementStatus = value; selectedReimbursementIds = []; } });
  Object.defineProperty(desk, "reimbursementFrom", { get: () => reimbursementFrom, set: (value) => { reimbursementFrom = value; selectedReimbursementIds = []; } });
  Object.defineProperty(desk, "reimbursementTo", { get: () => reimbursementTo, set: (value) => { reimbursementTo = value; selectedReimbursementIds = []; } });
  Object.defineProperty(desk, "search", { get: () => search, set: (value) => { search = value; } });
  Object.defineProperty(desk, "catalogSearch", { get: () => catalogSearch, set: (value) => { catalogSearch = value; } });
  Object.defineProperty(desk, "catalogKind", { get: () => catalogKind, set: (value) => { catalogKind = value; catalogSourceId = ""; catalogCategory = ""; } });
  Object.defineProperty(desk, "catalogPage", { get: () => catalogPage });
  Object.defineProperty(desk, "catalogPageCount", { get: () => catalogPageCount });
  Object.defineProperty(desk, "catalogPageSize", { get: () => catalogPageSize });
  Object.defineProperty(desk, "pagedCatalog", { get: () => pagedCatalog });
  Object.defineProperty(desk, "catalogSourceId", { get: () => catalogSourceId, set: (value) => { catalogSourceId = value; } });
  Object.defineProperty(desk, "catalogCategory", { get: () => catalogCategory, set: (value) => { catalogCategory = value; } });
  Object.defineProperty(desk, "catalogImportPreview", { get: () => catalogImportPreview });
  Object.defineProperty(desk, "catalogImportOwner", { get: () => catalogImportOwner, set: (value) => { catalogImportOwner = value; } });
  Object.defineProperty(desk, "catalogSourceOpen", { get: () => catalogSourceOpen, set: (value) => { catalogSourceOpen = value; } });
  Object.defineProperty(desk, "catalogSourceName", { get: () => catalogSourceName, set: (value) => { catalogSourceName = value; } });
  Object.defineProperty(desk, "catalogSourceCopyId", { get: () => catalogSourceCopyId, set: (value) => { catalogSourceCopyId = value; } });
  Object.defineProperty(desk, "reimbursementRejectOpen", { get: () => reimbursementRejectOpen, set: (value) => { reimbursementRejectOpen = value; } });
  Object.defineProperty(desk, "reimbursementRejectReason", { get: () => reimbursementRejectReason, set: (value) => { reimbursementRejectReason = value; } });
  Object.defineProperty(desk, "reimbursementRejectCount", { get: () => reimbursementRejectIds.length });
  Object.defineProperty(desk, "confirmOpen", { get: () => confirmOpen, set: (value) => { confirmOpen = value; } });
  Object.defineProperty(desk, "confirmTitle", { get: () => confirmTitle });
  Object.defineProperty(desk, "confirmMessage", { get: () => confirmMessage });
  Object.defineProperty(desk, "filterCustomer", { get: () => filterCustomer, set: (value) => { filterCustomer = value; } });
  Object.defineProperty(desk, "filterProject", { get: () => filterProject, set: (value) => { filterProject = value; } });
  Object.defineProperty(desk, "filterOwner", { get: () => filterOwner, set: (value) => { filterOwner = value; } });
  Object.defineProperty(desk, "filterDesigner", { get: () => filterDesigner, set: (value) => { filterDesigner = value; } });
  Object.defineProperty(desk, "filterCreator", { get: () => filterCreator, set: (value) => { filterCreator = value; } });
  Object.defineProperty(desk, "filterPayment", { get: () => filterPayment, set: (value) => { filterPayment = value; } });
  Object.defineProperty(desk, "filterFrom", { get: () => filterFrom, set: (value) => { filterFrom = value; } });
  Object.defineProperty(desk, "filterTo", { get: () => filterTo, set: (value) => { filterTo = value; } });
  Object.defineProperty(desk, "orderSort", { get: () => orderSort, set: (value) => { orderSort = value; } });
  Object.defineProperty(desk, "orderPage", { get: () => orderPage });
  Object.defineProperty(desk, "orderPageCount", { get: () => orderPageCount });
  Object.defineProperty(desk, "orderPageSize", { get: () => orderPageSize });
  Object.defineProperty(desk, "pagedOrders", { get: () => pagedOrders });
  Object.defineProperty(desk, "showExport", { get: () => showExport, set: (value) => { showExport = value; } });
  Object.defineProperty(desk, "exportMode", { get: () => exportMode, set: (value) => { exportMode = value; } });
  Object.defineProperty(desk, "exportTitle", { get: () => exportTitle, set: (value) => { exportTitle = value; } });
  Object.defineProperty(desk, "exportContract", { get: () => exportContract, set: (value) => { exportContract = value; } });
  Object.defineProperty(desk, "exportPartyA", { get: () => exportPartyA, set: (value) => { exportPartyA = value; } });
  Object.defineProperty(desk, "exportPartyB", { get: () => exportPartyB, set: (value) => { exportPartyB = value; } });
  Object.defineProperty(desk, "exportFollowA", { get: () => exportFollowA, set: (value) => { exportFollowA = value; } });
  Object.defineProperty(desk, "exportFollowB", { get: () => exportFollowB, set: (value) => { exportFollowB = value; } });
  Object.defineProperty(desk, "exportContactPhone", { get: () => exportContactPhone, set: (value) => { exportContactPhone = value; } });
  Object.defineProperty(desk, "exportRemarkOrder", { get: () => exportRemarkOrder, set: (value) => { exportRemarkOrder = value; } });
  Object.defineProperty(desk, "exportExpand", { get: () => exportExpand, set: (value) => { exportExpand = value; } });
  Object.defineProperty(desk, "exportTotal", { get: () => exportTotal, set: (value) => { exportTotal = value; } });
  Object.defineProperty(desk, "exportSign", { get: () => exportSign, set: (value) => { exportSign = value; } });
  Object.defineProperty(desk, "showOrderFilters", { get: () => showOrderFilters, set: (value) => { showOrderFilters = value; } });
  Object.defineProperty(desk, "showStandaloneReimbursement", { get: () => showStandaloneReimbursement, set: (value) => { showStandaloneReimbursement = value; } });
  Object.defineProperty(desk, "selectedReimbursementIds", { get: () => selectedReimbursementIds, set: (value) => { selectedReimbursementIds = value; } });
  Object.defineProperty(desk, "standaloneEmployee", { get: () => standaloneEmployee, set: (value) => { standaloneEmployee = value; } });
  Object.defineProperty(desk, "standaloneItem", { get: () => standaloneItem, set: (value) => { standaloneItem = value; } });
  Object.defineProperty(desk, "standaloneAmount", { get: () => standaloneAmount, set: (value) => { standaloneAmount = value; } });
  Object.defineProperty(desk, "standaloneDate", { get: () => standaloneDate, set: (value) => { standaloneDate = value; } });
  Object.defineProperty(desk, "standaloneOrderId", { get: () => standaloneOrderId, set: (value) => { standaloneOrderId = value; } });
  Object.defineProperty(desk, "standaloneInvoice", { get: () => standaloneInvoice, set: (value) => { standaloneInvoice = value; } });
  Object.defineProperty(desk, "standaloneNote", { get: () => standaloneNote, set: (value) => { standaloneNote = value; } });
  Object.defineProperty(desk, "selectedOrderIds", { get: () => selectedOrderIds, set: (value) => { selectedOrderIds = value; } });
  Object.defineProperty(desk, "selectedColumns", { get: () => selectedColumns, set: (value) => { selectedColumns = value; } });
  Object.defineProperty(desk, "visibleOrderColumns", { get: () => visibleOrderColumns });
  desk.orderColumnOptions = orderColumnOptions;
  Object.defineProperty(desk, "filteredProjects", { get: () => filteredProjects });
  Object.defineProperty(desk, "visibleCatalog", { get: () => visibleCatalog });
  Object.defineProperty(desk, "catalogCategories", { get: () => catalogCategories });
  Object.defineProperty(desk, "selectedCustomer", { get: () => selectedCustomer });
  Object.defineProperty(desk, "selectedProject", { get: () => selectedProject });
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
  Object.defineProperty(desk, "reimbursementStats", { get: () => reimbursementStats });
  Object.defineProperty(desk, "reimbursementRowsForRole", { get: () => reimbursementRowsForRole });
  Object.defineProperty(desk, "reimbursementRows", { get: () => reimbursementRows });
  Object.defineProperty(desk, "reimbursementPaymentSummary", { get: () => reimbursementPaymentSummary });
  Object.defineProperty(desk, "selectedPendingReviewCount", { get: () => selectedPendingReviewCount });
  Object.defineProperty(desk, "selectedPendingPaymentCount", { get: () => selectedPendingPaymentCount });
  Object.defineProperty(desk, "reimbursementVouchers", { get: () => reimbursementVouchers });
  Object.defineProperty(desk, "creators", { get: () => creators });
  desk.money = money;
  desk.navigate = navigate;
  desk.setOrderPage = setOrderPage;
  desk.setCatalogPage = setCatalogPage;
  desk.setWorkMode = setWorkMode;
  desk.refresh = refresh;
  desk.markReimbursement = markReimbursement;
  desk.openStandaloneReimbursement = openStandaloneReimbursement;
  desk.exportReimbursements = exportReimbursements;
  desk.batchMarkReimbursed = batchMarkReimbursed;
  desk.selectEmployeePayments = selectEmployeePayments;
  desk.markEmployeeReimbursed = markEmployeeReimbursed;
  desk.exportPaymentSummary = exportPaymentSummary;
  desk.batchReviewReimbursements = batchReviewReimbursements;
  desk.batchRejectReimbursements = batchRejectReimbursements;
  desk.rejectReimbursement = rejectReimbursement;
  desk.generateReimbursementVoucher = generateReimbursementVoucher;
  desk.archiveReimbursementVoucher = archiveReimbursementVoucher;
  desk.reuploadReimbursement = reuploadReimbursement;
  desk.resetReimbursementFilters = resetReimbursementFilters;
  desk.toggleReimbursement = toggleReimbursement;
  desk.deleteReimbursement = deleteReimbursement;
  desk.submitStandaloneReimbursement = submitStandaloneReimbursement;
  desk.onStandaloneInvoiceChange = onStandaloneInvoiceChange;
  desk.submitOrder = submitOrder;
  desk.submitProject = submitProject;
  desk.importFile = importFile;
  desk.openCatalogSourceForm = openCatalogSourceForm;
  desk.createCatalogSourceFromForm = createCatalogSourceFromForm;
  desk.confirmCatalogImport = confirmCatalogImport;
  desk.cancelCatalogImport = cancelCatalogImport;
  desk.confirmRejectReimbursements = confirmRejectReimbursements;
  desk.runConfirm = runConfirm;
  desk.toggleOrder = toggleOrder;
  desk.toggleFilteredOrders = toggleFilteredOrders;
  desk.openExport = openExport;
  desk.downloadExport = downloadExport;
  desk.copyExportTable = copyExportTable;
  desk.toggleColumn = toggleColumn;
  desk.toggleOrderColumn = toggleOrderColumn;
  desk.resetOrderFilters = resetOrderFilters;
  desk.onFilterCustomerChange = onFilterCustomerChange;
  desk.deleteOrder = deleteOrder;
  desk.openDetail = openDetail;
  desk.removeNoteFile = removeNoteFile;
  desk.onAdvanceInvoiceChange = onAdvanceInvoiceChange;
  desk.removeAdvanceInvoice = removeAdvanceInvoice;
  desk.onNoteFilesChange = onNoteFilesChange;
  desk.attachmentUrl = attachmentUrl;
  desk.reimbursementAttachmentUrl = reimbursementAttachmentUrl;
  desk.openAttachmentPreview = openAttachmentPreview;
  desk.openLocalAttachmentPreview = openLocalAttachmentPreview;
  desk.closeAttachmentPreview = closeAttachmentPreview;
  desk.formatFileSize = formatFileSize;
  desk.editOrder = editOrder;
  desk.startNewOrder = startNewOrder;
  desk.addProduct = addProduct;
  desk.removeProduct = removeProduct;
  desk.updateProduct = updateProduct;
  desk.applyProductCatalog = applyProductCatalog;
  desk.matchProductCatalog = matchProductCatalog;
  desk.addCost = addCost;
  desk.removeCost = removeCost;
  desk.updateCost = updateCost;
  desk.applyCostCatalog = applyCostCatalog;
  desk.addAdvance = addAdvance;
  desk.removeAdvance = removeAdvance;
  desk.updateAdvance = updateAdvance;
  desk.canEditAdvance = canEditAdvance;
  desk.markOrderDirty = markOrderDirty;
  desk.onCustomerChange = onCustomerChange;
  desk.saveCreatorName = saveCreatorName;
  desk.removeCreatorName = removeCreatorName;
  desk.openSettings = openSettings;
  desk.exportColumns = exportColumns;
  return desk;
}
