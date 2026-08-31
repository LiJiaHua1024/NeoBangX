/* NeoBangX Admin Frontend */

/* ---------- 剪贴板复制（兼容 HTTP 内网部署：execCommand 回退，不依赖安全上下文） ---------- */
function copyToClipboard(text) {
  return new Promise((resolve) => {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;opacity:0;pointer-events:none;";
      document.body.appendChild(ta);
      const sel = document.getSelection();
      const restore = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      if (restore) {
        sel.removeAllRanges();
        sel.addRange(restore);
      }
      ta.remove();
      resolve(ok);
    };
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => resolve(true), fallback);
    } else {
      fallback();
    }
  });
}

const ADMIN_THEMES = [
  { id: "paper", name: "宣纸", dot: "linear-gradient(135deg,#b4502a,#8c3316)" },
  { id: "celadon", name: "青瓷", dot: "linear-gradient(135deg,#0e6e5f,#0a5245)" },
  { id: "obsidian", name: "曜石", dot: "linear-gradient(135deg,#e9a15b,#cf7038)" },
  { id: "jade", name: "墨翠", dot: "linear-gradient(135deg,#5cb787,#2f8a66)" },
];

function adminApp() {
  return {
    version: "1.1.0",
    theme: "paper",
    themes: ADMIN_THEMES,
    tab: "dashboard",
    loading: false,
    stats: {},
    securityWarning: false,
    securityBannerDismissed: false,
    rotatingSecret: false,
    codes: [],
    codesTotal: 0,
    codesPage: 1,
    codesPageSize: 20,
    codeQuery: "",
    codeTypeFilter: "",
    codeEnabledFilter: "",
    codeTypeMenuOpen: false,
    codeEnabledMenuOpen: false,
    logs: [],
    logsTotal: 0,
    logsPage: 1,
    logsPageSize: 30,
    logsPageSizeOptions: [30, 50, 100],
    logsSizeMenuOpen: false,
    logCode: "",
    logToolId: "",
    logModel: "",
    logStart: "",
    logEnd: "",
    datePickerOpen: null,
    datePickerMode: "days",
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth(),
    calHoverIso: "",
    calMonthNames: ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
    logsStatusFilter: "",
    logsStatusMenuOpen: false,
    logStatusOptions: [
      { id: "", label: "全部状态" },
      { id: "success", label: "成功" },
      { id: "cancelled", label: "用户停止" },
      { id: "error", label: "异常" },
    ],
    logSummary: {},
    // 详情抽屉
    logDetailOpen: false,
    logDetail: null,
    logDetailLoading: false,
    logDetailError: "",
    payloadParts: [
      { key: "input", label: "用户输入", open: true },
      { key: "prompt", label: "渲染后的完整 Prompt", open: false },
      { key: "output", label: "模型输出", open: true },
    ],
    // null = 尚未读取；决定日志页「未开启记录」提示是否展示
    payloadRecording: null,
    purgeDays: null,
    purging: false,
    configForm: {
      default_model: "",
      models: [],
      llm_base_url: "",
      llm_api_key: "",
      llm_model: "",
      chores_model: "",
      chores_base_url: "",
      chores_api_key: "",
      max_tokens: 4096,
      timeout: 120,
      log_payload: false,
      log_retention_days: 0,
    },
    hasLlmKey: false,
    hasChoresKey: false,
    savingConfig: false,
    defaultModelMenuOpen: false,
    legacyConfigOpen: false,
    // 多 Provider 聚合
    providers: [],
    modelProviderMap: {},
    modelProviderDetails: {},
    savingProvider: false,
    testingProviderId: null,
    // Provider 测试弹窗（弹窗选模型，自动预填 provider_model_id + prompt）
    providerTestModalOpen: false,
    providerTestForm: { providerId: "", model: "", provider_model_id: "", prompt: "Hello" },
    providerTestModelMenuOpen: false,
    // Provider 弹窗
    providerModalOpen: false,
    providerForm: { id: "", name: "", base_url: "", api_key: "", enabled: true },
    // 模型 Provider 绑定弹窗（每模型独立优先级 + per-provider model id）
    modelProvidersModalOpen: false,
    modelProvidersModelId: "",
    modelProvidersModelName: "",
    modelProvidersOrdered: [], // [{provider_id, provider_model_id}]
    savingModelProviders: false,
    modelProvidersDragIndex: null,
    modelProvidersDragOverIndex: null,
    modelProvidersPickOpen: true,
    modelProvidersOrderedOpen: true,
    // 模型表格内 Provider 拖拽
    providerDragModelId: null,
    providerDragIndex: null,
    providerDragOverIndex: null,
    // 日志 Provider 筛选
    logProvider: "",
    // 模型添加/编辑弹窗
    modelModalOpen: false,
    modelModalIndex: null,
    modelForm: { id: "", name: "", description: "", score: null, mode: "default", thinking_budget: null },
    thinkingMenuOpen: false,
    // 模型拖拽排序
    dragIndex: null,
    dragOverIndex: null,
    dragOverBefore: false,
    thinkingModes: [
      { id: "default", label: "跟随模型默认", hint: "不传任何参数，是否思考由供应商默认策略决定" },
      { id: "none", label: "关闭思考", hint: "尽可能禁用思考，响应更快、消耗更少" },
      { id: "minimal", label: "最低强度", hint: "保留极少量思考" },
      { id: "low", label: "低强度", hint: "轻度思考，适合简单任务" },
      { id: "medium", label: "中强度", hint: "均衡的思考投入" },
      { id: "high", label: "高强度", hint: "深度思考，适合复杂分析任务，响应较慢" },
      { id: "budget", label: "自定义 Token 预算", hint: "显式指定思考 token 上限（Anthropic 风格 thinking 参数）" },
    ],
    createOpen: false,
    creating: false,
    createForm: { code_type: "user", quota: 10, count: 1, note: "" },
    createTypeMenuOpen: false,
    createQuotaMenuOpen: false,
    quotaPresets: [1, 3, 5, 10, 50, 100, 200, 500, 1000],
    createdItems: [],
    quotaModalOpen: false,
    savingQuota: false,
    editingQuotaId: null,
    editingQuotaCode: "",
    editingQuotaUsed: 0,
    editingQuotaValue: 10,
    editQuotaMenuOpen: false,
    toasts: [],

    get pageTitle() {
      return (
        {
          dashboard: "概览",
          codes: "使用码管理",
          logs: "使用日志",
          logsettings: "日志设置",
          config: "API 配置",
        }[this.tab] || "管理后台"
      );
    },
    get pageDesc() {
      return (
        {
          dashboard: "查看整体使用情况与快捷入口",
          codes: "生成、启用/禁用/删除使用码，查看额度",
          logs: "查看每次工具调用的详细记录",
          logsettings: "配置原始数据记录开关与日志保留策略",
          config: "管理 LLM 密钥、模型与调用参数",
        }[this.tab] || ""
      );
    },
    get codeTypeFilterLabel() {
      const map = { "": "全部类型", user: "普通用户", admin: "管理员" };
      return map[this.codeTypeFilter] || "全部类型";
    },
    get codeEnabledFilterLabel() {
      const map = { "": "全部状态", true: "已启用", false: "已禁用" };
      return map[this.codeEnabledFilter] || "全部状态";
    },
    get logsStatusFilterLabel() {
      const opt = this.logStatusOptions.find((o) => o.id === this.logsStatusFilter);
      return opt ? opt.label : "全部状态";
    },
    get hasLogFilters() {
      return !!(
        this.logCode.trim() ||
        this.logToolId.trim() ||
        this.logModel.trim() ||
        this.logProvider.trim() ||
        this.logsStatusFilter ||
        this.logStart ||
        this.logEnd
      );
    },
    get logsPageCount() {
      return Math.max(1, Math.ceil(this.logsTotal / this.logsPageSize));
    },
    get defaultModelLabel() {
      const m = this.configForm.models.find((x) => x.id === this.configForm.default_model);
      if (m) return m.name || m.id;
      return this.configForm.default_model || "请选择默认模型";
    },
    get defaultModelMissing() {
      return (
        !!this.configForm.default_model &&
        this.configForm.models.length > 0 &&
        !this.configForm.models.some((m) => m.id === this.configForm.default_model)
      );
    },
    get providersById() {
      const map = {};
      for (const p of this.providers) map[p.id] = p;
      return map;
    },
    get hasUnboundModels() {
      return this.configForm.models.some((m) => !(this.modelProviderMap[m.id] && this.modelProviderMap[m.id].length));
    },
    get unboundModelCount() {
      return this.configForm.models.filter((m) => !(this.modelProviderMap[m.id] && this.modelProviderMap[m.id].length)).length;
    },

    async init() {
      const saved = localStorage.getItem("nbx_admin_theme");
      if (saved && ADMIN_THEMES.some((t) => t.id === saved)) this.theme = saved;
      this.applyTheme();
      try {
        this.securityBannerDismissed = sessionStorage.getItem("nbx_jwt_warn_dismissed") === "1";
      } catch {}
      await this.refreshAll();
    },

    dismissSecurityBanner() {
      this.securityBannerDismissed = true;
      try { sessionStorage.setItem("nbx_jwt_warn_dismissed", "1"); } catch {}
    },

    async rotateJwtSecret() {
      const confirmed = confirm(
        "将生成新的随机 JWT 密钥并保存到数据卷：\n\n" +
        "· 本管理后台立即生效\n" +
        "· 主站(8000)需重启后生效（docker-compose restart）\n" +
        "· 主站重启后所有老师需重新输入使用码\n\n确定继续吗？"
      );
      if (!confirmed) return;
      this.rotatingSecret = true;
      try {
        await this.api("/api/admin/jwt-secret/rotate", { method: "POST" });
        this.toast("已生成新密钥并保存；重启主站(8000)后全部生效", "ok");
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "生成失败，请检查数据卷写入权限", "error");
      } finally {
        this.rotatingSecret = false;
      }
    },

    setTheme(id) {
      this.theme = id;
      this.applyTheme();
      try { localStorage.setItem("nbx_admin_theme", id); } catch {}
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme;
    },

    async refreshAll() {
      this.loading = true;
      try {
        await Promise.all([this.loadStats(), this.loadCodes(), this.loadLogs()]);
        if (this.tab === "config" || this.tab === "logsettings") await this.loadConfig();
      } finally {
        this.loading = false;
      }
    },

    async api(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        let msg =
          (data && (data.detail || data.message)) ||
          `请求失败 HTTP ${res.status}`;
        if (Array.isArray(msg)) {
          // FastAPI 参数校验失败时 detail 是错误对象数组，转成可读文案而非原始 JSON
          const first = msg[0] || {};
          const fieldPath = Array.isArray(first.loc)
            ? first.loc.filter((part) => part !== "body").join(".")
            : "";
          msg = [fieldPath, first.msg].filter(Boolean).join("：") || "提交的参数不合法";
        }
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return data;
    },

    toast(msg, type = "ok") {
      const id = Date.now() + Math.random();
      this.toasts.push({ id, msg, type });
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
      }, 2800);
    },

    fmtTime(iso) {
      if (!iso) return "—";
      try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return iso;
        const pad = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      } catch {
        return iso;
      }
    },

    async copyText(text) {
      const ok = await copyToClipboard(text);
      if (ok) this.toast("已复制");
      else this.toast("复制失败，请手动复制", "error");
    },

    async loadStats() {
      try {
        this.stats = await this.api("/api/admin/stats");
        this.securityWarning = !!(
          this.stats.security && this.stats.security.jwt_secret_is_default
        );
      } catch (e) {
        this.toast(e.message || "加载统计失败", "error");
      }
    },

    async loadCodes() {
      try {
        const params = new URLSearchParams({
          page: String(this.codesPage),
          page_size: String(this.codesPageSize),
        });
        if (this.codeQuery.trim()) params.set("q", this.codeQuery.trim());
        if (this.codeTypeFilter) params.set("code_type", this.codeTypeFilter);
        if (this.codeEnabledFilter !== "") params.set("enabled", this.codeEnabledFilter);

        const data = await this.api(`/api/admin/codes?${params}`);
        this.codes = data.items || [];
        this.codesTotal = data.total || 0;
        // 删除/禁用后当前页可能已超出末页（返回空列表但 total 正常），收敛页码重查
        const maxPage = Math.max(1, Math.ceil(this.codesTotal / this.codesPageSize));
        if (this.codesPage > maxPage) {
          this.codesPage = maxPage;
          return this.loadCodes();
        }
      } catch (e) {
        this.toast(e.message || "加载使用码失败", "error");
      }
    },

    openCreate() {
      this.createForm = { code_type: "user", quota: 10, count: 1, note: "" };
      this.createdItems = [];
      this.createOpen = true;
      this.createTypeMenuOpen = false;
      this.createQuotaMenuOpen = false;
    },

    async createCodes() {
      this.creating = true;
      try {
        const body = {
          code_type: this.createForm.code_type,
          quota: this.createForm.code_type === "admin" ? -1 : Number(this.createForm.quota) || 1,
          count: Number(this.createForm.count) || 1,
          note: this.createForm.note || "",
        };
        const data = await this.api("/api/admin/codes", {
          method: "POST",
          body: JSON.stringify(body),
        });
        this.createdItems = data.items || [];
        this.toast(`已生成 ${data.count} 个使用码`);
        await this.loadCodes();
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "生成失败", "error");
      } finally {
        this.creating = false;
      }
    },

    async copyCreated() {
      const text = this.createdItems.map((i) => i.code).join("\n");
      await this.copyText(text);
    },

    async toggleCode(c) {
      try {
        await this.api(`/api/admin/codes/${c.id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_enabled: !c.is_enabled }),
        });
        this.toast(c.is_enabled ? "已禁用" : "已启用");
        await this.loadCodes();
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      }
    },

    async editNote(c) {
      const note = prompt("备注", c.note || "");
      if (note === null) return;
      try {
        await this.api(`/api/admin/codes/${c.id}`, {
          method: "PATCH",
          body: JSON.stringify({ note }),
        });
        this.toast("备注已更新");
        await this.loadCodes();
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      }
    },

    openEditQuota(c) {
      this.editingQuotaId = c.id;
      this.editingQuotaCode = c.code;
      this.editingQuotaUsed = c.used_count;
      this.editingQuotaValue = c.quota;
      this.editQuotaMenuOpen = false;
      this.quotaModalOpen = true;
    },

    async saveEditQuota() {
      const quota = parseInt(this.editingQuotaValue, 10);
      if (!Number.isFinite(quota) || quota < 1) {
        this.toast("额度需为正整数", "error");
        return;
      }
      this.savingQuota = true;
      try {
        await this.api(`/api/admin/codes/${this.editingQuotaId}`, {
          method: "PATCH",
          body: JSON.stringify({ quota }),
        });
        this.toast("额度已更新");
        this.quotaModalOpen = false;
        await this.loadCodes();
      } catch (e) {
        this.toast(e.message || "更新失败", "error");
      } finally {
        this.savingQuota = false;
      }
    },

    async deleteCode(c) {
      if (!confirm(`确定要删除使用码「${c.code}」吗？此操作不可恢复。`)) return;
      try {
        await this.api(`/api/admin/codes/${c.id}`, { method: "DELETE" });
        this.toast("已删除");
        await this.loadCodes();
        await this.loadStats();
      } catch (e) {
        this.toast(e.message || "删除失败", "error");
      }
    },

    /* ============ 使用日志 ============ */
    logStatusLabel(status) {
      const map = { success: "成功", cancelled: "用户停止", error: "异常" };
      return map[status] || "成功";
    },

    fmtNum(value) {
      if (value == null || value === "" || !Number.isFinite(Number(value))) return "—";
      return Number(value).toLocaleString("zh-CN");
    },

    /* 扣费次数：null = 旧记录升级前未保存该字段，与「本次未扣费」(0) 不是一回事 */
    fmtUnits(units) {
      if (units == null || !Number.isFinite(Number(units))) return "—";
      return Number(units) > 0 ? `${units} 次` : "未扣费";
    },

    fmtDuration(ms) {
      if (ms == null || ms === "" || !Number.isFinite(Number(ms))) return "—";
      const v = Number(ms);
      if (v < 1000) return `${Math.round(v)} ms`;
      if (v < 60000) return `${(v / 1000).toFixed(1)} s`;
      const total = Math.round(v / 1000);
      return `${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, "0")} 秒`;
    },

    _toIso(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    },
    _parseIso(iso) {
      if (!iso || typeof iso !== "string") return null;
      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    },
    _todayIso() {
      return this._toIso(new Date());
    },
    fmtDateLabel(iso, placeholder) {
      return this._parseIso(iso) ? iso : placeholder;
    },

    get calCaption() {
      if (this.datePickerMode === "years") {
        const start = Math.floor(this.calYear / 12) * 12;
        return `${start} – ${start + 11}`;
      }
      if (this.datePickerMode === "months") return `${this.calYear} 年`;
      return `${this.calYear} 年 ${this.calMonth + 1} 月`;
    },
    get calYears() {
      const start = Math.floor(this.calYear / 12) * 12;
      return Array.from({ length: 12 }, (_, i) => start + i);
    },
    get calendarCells() {
      const y = this.calYear;
      const m = this.calMonth;
      const first = new Date(y, m, 1);
      const startPad = (first.getDay() + 6) % 7;
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const prevDays = new Date(y, m, 0).getDate();
      const today = this._todayIso();
      const cells = [];
      for (let i = 0; i < 42; i++) {
        let day;
        let monthOffset;
        if (i < startPad) {
          day = prevDays - startPad + i + 1;
          monthOffset = -1;
        } else if (i < startPad + daysInMonth) {
          day = i - startPad + 1;
          monthOffset = 0;
        } else {
          day = i - startPad - daysInMonth + 1;
          monthOffset = 1;
        }
        const date = new Date(y, m + monthOffset, day);
        const iso = this._toIso(date);
        cells.push({ iso, day, outside: monthOffset !== 0, today: iso === today });
      }
      return cells;
    },

    toggleDatePicker(key) {
      if (this.datePickerOpen === key) {
        this.closeDatePicker();
        return;
      }
      this.logsStatusMenuOpen = false;
      this.datePickerOpen = key;
      this.datePickerMode = "days";
      this.calHoverIso = "";
      const iso = key === "start" ? this.logStart : this.logEnd;
      const base = this._parseIso(iso) || new Date();
      this.calYear = base.getFullYear();
      this.calMonth = base.getMonth();
    },
    closeDatePicker() {
      this.datePickerOpen = null;
      this.datePickerMode = "days";
      this.calHoverIso = "";
    },
    calStep(dir) {
      if (this.datePickerMode === "days") {
        const d = new Date(this.calYear, this.calMonth + dir, 1);
        this.calYear = d.getFullYear();
        this.calMonth = d.getMonth();
      } else if (this.datePickerMode === "months") {
        this.calYear += dir;
      } else {
        this.calYear += dir * 12;
      }
    },
    calDrill() {
      if (this.datePickerMode === "days") this.datePickerMode = "months";
      else if (this.datePickerMode === "months") this.datePickerMode = "years";
    },
    calPickMonth(idx) {
      this.calMonth = idx;
      this.datePickerMode = "days";
    },
    calPickYear(y) {
      this.calYear = y;
      this.datePickerMode = "months";
    },
    calDayClass(cell) {
      const iso = cell.iso;
      const start = this.logStart;
      const end = this.logEnd;
      let from = start;
      let to = end;
      let previewing = false;
      const hover = this.calHoverIso;
      if (hover) {
        if (this.datePickerOpen === "end" && start) { to = hover; previewing = true; }
        if (this.datePickerOpen === "start" && end) { from = hover; previewing = true; }
      }
      const lo = from && to && from > to ? to : from;
      const hi = from && to && from > to ? from : to;
      const selected = previewing ? iso === lo || iso === hi : iso === start || iso === end;
      return {
        outside: cell.outside,
        today: cell.today,
        selected,
        "in-range": !!(lo && hi && iso > lo && iso < hi),
        "range-start": !!(lo && hi && iso === lo && lo !== hi),
        "range-end": !!(lo && hi && iso === hi && lo !== hi),
      };
    },
    pickDate(iso) {
      if (this.datePickerOpen === "start") {
        this.logStart = iso;
        if (this.logStart && this.logEnd && this.logStart > this.logEnd) {
          const tmp = this.logStart;
          this.logStart = this.logEnd;
          this.logEnd = tmp;
        }
        if (!this.logEnd) {
          this.datePickerOpen = "end";
          this.calHoverIso = "";
          return;
        }
      } else if (this.datePickerOpen === "end") {
        this.logEnd = iso;
        if (this.logStart && this.logEnd && this.logStart > this.logEnd) {
          const tmp = this.logStart;
          this.logStart = this.logEnd;
          this.logEnd = tmp;
        }
      }
      this.closeDatePicker();
    },
    calPickToday() {
      this.pickDate(this._todayIso());
    },
    calClear() {
      if (this.datePickerOpen === "start") this.logStart = "";
      else if (this.datePickerOpen === "end") this.logEnd = "";
    },

    /* 日期按管理员本地日历日换算成 UTC 瞬时：结束日期取次日零点（后端上界开区间） */
    _logFilterParams() {
      const params = new URLSearchParams();
      if (this.logCode.trim()) params.set("code", this.logCode.trim());
      if (this.logToolId.trim()) params.set("tool_id", this.logToolId.trim());
      if (this.logModel.trim()) params.set("model", this.logModel.trim());
      if (this.logProvider.trim()) params.set("provider", this.logProvider.trim());
      if (this.logsStatusFilter) params.set("status", this.logsStatusFilter);
      const start = this.logStart ? new Date(`${this.logStart}T00:00:00`) : null;
      if (start && !Number.isNaN(start.getTime())) params.set("start", start.toISOString());
      if (this.logEnd) {
        const end = new Date(`${this.logEnd}T00:00:00`);
        if (!Number.isNaN(end.getTime())) {
          end.setDate(end.getDate() + 1);
          params.set("end", end.toISOString());
        }
      }
      return params;
    },

    openLogsTab() {
      this.loadLogs();
      this.loadPayloadFlag();
    },

    async loadLogs() {
      try {
        const params = this._logFilterParams();
        params.set("page", String(this.logsPage));
        params.set("page_size", String(this.logsPageSize));
        const data = await this.api(`/api/admin/logs?${params}`);
        this.logs = data.items || [];
        this.logsTotal = data.total || 0;
        // 清理后当前页可能已超出末页（返回空列表但 total 正常），收敛页码重查
        const maxPage = Math.max(1, Math.ceil(this.logsTotal / this.logsPageSize));
        if (this.logsPage > maxPage) {
          this.logsPage = maxPage;
          return this.loadLogs();
        }
      } catch (e) {
        this.toast(e.message || "加载日志失败", "error");
      }
      await this.loadLogSummary();
    },

    async loadLogSummary() {
      try {
        const params = this._logFilterParams();
        this.logSummary = await this.api(`/api/admin/logs/summary?${params}`);
      } catch (e) {
        this.logSummary = {};
      }
    },

    async loadPayloadFlag() {
      try {
        const data = await this.api("/api/admin/config");
        this.payloadRecording = /^(1|true|yes|on)$/i.test(String(data.config?.log_payload ?? ""));
      } catch {
        this.payloadRecording = null;
      }
    },

    resetLogFilters() {
      this.logCode = "";
      this.logToolId = "";
      this.logModel = "";
      this.logProvider = "";
      this.logsStatusFilter = "";
      this.logStart = "";
      this.logEnd = "";
      this.closeDatePicker();
      this.logsPage = 1;
      this.loadLogs();
    },

    async openLogDetail(id) {
      this.logDetail = null;
      this.logDetailError = "";
      this.logDetailLoading = true;
      this.logDetailOpen = true;
      try {
        this.logDetail = await this.api(`/api/admin/logs/${id}`);
      } catch (e) {
        this.logDetailError = e.message || "加载详情失败";
        this.toast(this.logDetailError, "error");
      } finally {
        this.logDetailLoading = false;
      }
    },

    closeLogDetail() {
      this.logDetailOpen = false;
      this.logDetail = null;
      this.logDetailError = "";
    },

    filterByLogCode() {
      if (!this.logDetail) return;
      this.logCode = this.logDetail.code || "";
      this.logsPage = 1;
      this.loadLogs();
    },

    async copyLogSummaryText() {
      const l = this.logDetail;
      if (!l) return;
      const text = [
        `日志 #${l.id}`,
        `时间：${this.fmtTime(l.created_at)}`,
        `使用码：${l.code}`,
        `工具：${l.tool_name || "—"}（ID ${l.tool_id || "—"}）`,
        `模型：${l.model || "—"}`,
        `Provider：${l.provider_name ? `${l.provider_name} (${l.provider_id})` : (l.provider_id || "—")}  尝试 ${l.fallback_attempts ?? "—"} 次`,
        `状态：${this.logStatusLabel(l.status)}`,
        `耗时：${this.fmtDuration(l.duration_ms)}`,
        `Tokens：输入 ${l.prompt_tokens ?? "—"} / 输出 ${l.completion_tokens ?? "—"} / 合计 ${l.total_tokens ?? "—"}${l.tokens_estimated ? "（估算值）" : ""}`,
        `扣费：${this.fmtUnits(l.units)}`,
        `IP：${l.ip || "—"}`,
        `UA：${l.user_agent || "—"}`,
        `请求 ID：${l.request_id || "—"}`,
        l.error_message ? `错误信息：${l.error_message}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      await this.copyText(text);
    },

    async purgeLogs() {
      const input = Number(this.purgeDays);
      const useConfig = this.purgeDays === null || this.purgeDays === "" || !Number.isFinite(input);
      const days = Math.max(0, Math.floor(useConfig ? Number(this.configForm.log_retention_days) || 0 : input));
      if (days <= 0) {
        this.toast("保留天数为 0 表示永久保留，不会删除任何日志", "error");
        return;
      }
      if (!confirm(`将永久删除 ${days} 天之前的全部使用日志（含原始输入/输出），此操作不可恢复。\n\n确定继续吗？`)) {
        return;
      }
      this.purging = true;
      try {
        const data = await this.api("/api/admin/logs/purge", {
          method: "POST",
          body: JSON.stringify({ days }),
        });
        this.toast(`已清理 ${data.deleted} 条日志`);
        await Promise.all([this.loadLogs(), this.loadStats()]);
      } catch (e) {
        this.toast(e.message || "清理失败", "error");
      } finally {
        this.purging = false;
      }
    },

    async loadConfig() {
      try {
        const data = await this.api("/api/admin/config");
        const cfg = data.config || {};
        this.configForm = {
          default_model: cfg.default_model || "",
          models: Array.isArray(cfg.models)
            ? cfg.models.map((m) => ({
                id: m.id || "",
                name: m.name && m.name !== m.id ? m.name : "",
                description: m.description || "",
                score: m.score ?? null,
                reasoning_effort: m.reasoning_effort || null,
                thinking_budget: m.thinking_budget || null,
              }))
            : [],
          llm_base_url: cfg.llm_base_url || "",
          llm_api_key: cfg.llm_api_key || "",
          llm_model: cfg.llm_model || "",
          chores_model: cfg.chores_model || "",
          chores_base_url: cfg.chores_base_url || "",
          chores_api_key: cfg.chores_api_key || "",
          max_tokens: Number(cfg.max_tokens) || 4096,
          timeout: Number(cfg.timeout) || 120,
          log_payload: /^(1|true|yes|on)$/i.test(String(cfg.log_payload ?? "")),
          log_retention_days: Number(cfg.log_retention_days) || 0,
        };
        this.hasLlmKey = !!data.has_llm_api_key;
        this.hasChoresKey = !!data.has_chores_api_key;
        this.payloadRecording = this.configForm.log_payload;
        // 多 Provider 聚合
        this.providers = Array.isArray(data.providers) ? data.providers : [];
        this.modelProviderMap = data.model_provider_map && typeof data.model_provider_map === 'object' ? data.model_provider_map : {};
        this.modelProviderDetails = data.model_provider_details && typeof data.model_provider_details === 'object' ? data.model_provider_details : {};
        // 兼容旧接口：若没有 providers 则尝试从 /model-providers 拉取
        if (!this.providers.length || !Object.keys(this.modelProviderMap).length) {
          try {
            const mp = await this.api("/api/admin/model-providers");
            if (!this.providers.length && Array.isArray(mp.providers)) this.providers = mp.providers;
            if (!Object.keys(this.modelProviderMap).length && mp.map) this.modelProviderMap = mp.map;
            if (!Object.keys(this.modelProviderDetails).length && mp.details) this.modelProviderDetails = mp.details;
          } catch {}
        }
        // 若 details 缺失则从 map 构造默认（provider_model_id 回退为逻辑 id）
        if (!Object.keys(this.modelProviderDetails).length && Object.keys(this.modelProviderMap).length) {
          for (const mid in this.modelProviderMap) {
            this.modelProviderDetails[mid] = (this.modelProviderMap[mid] || []).map(pid => ({ provider_id: pid, provider_model_id: mid, priority: 0 }));
          }
        }
      } catch (e) {
        this.toast(e.message || "加载配置失败", "error");
      }
    },

    /* ============ 模型管理 ============ */
    scoreColor(score) {
      if (score == null || !Number.isFinite(Number(score))) return "";
      const s = Math.max(0, Math.min(10, Number(score)));
      return `hsl(${Math.round(s * 12)} 85% 45%)`;
    },
    thinkingLabel(m) {
      if (m.thinking_budget) return `预算 ${m.thinking_budget} tokens`;
      const opt = this.thinkingModes.find((o) => o.id === m.reasoning_effort);
      return opt ? opt.label : "跟随模型默认";
    },
    thinkingModeLabel(mode) {
      const opt = this.thinkingModes.find((o) => o.id === mode);
      return opt ? opt.label : "跟随模型默认";
    },
    thinkingModeHint(mode) {
      const opt = this.thinkingModes.find((o) => o.id === mode);
      return opt ? opt.hint : "";
    },

    openAddModel() {
      this.modelModalIndex = null;
      this.modelForm = { id: "", name: "", description: "", score: null, mode: "default", thinking_budget: null };
      this.thinkingMenuOpen = false;
      this.modelModalOpen = true;
    },

    openEditModel(i) {
      const m = this.configForm.models[i];
      if (!m) return;
      this.modelModalIndex = i;
      this.modelForm = {
        id: m.id,
        name: m.name || "",
        description: m.description || "",
        score: m.score ?? null,
        mode: m.thinking_budget ? "budget" : m.reasoning_effort || "default",
        thinking_budget: m.thinking_budget || null,
      };
      this.thinkingMenuOpen = false;
      this.modelModalOpen = true;
    },

    saveModelModal() {
      const id = (this.modelForm.id || "").trim();
      if (!id) {
        this.toast("模型 ID 不能为空", "error");
        return;
      }
      const dupIndex = this.configForm.models.findIndex((m) => m.id === id);
      if (dupIndex !== -1 && dupIndex !== this.modelModalIndex) {
        this.toast("该模型 ID 已在列表中", "error");
        return;
      }
      const mode = this.modelForm.mode;
      if (mode === "budget") {
        const budget = parseInt(this.modelForm.thinking_budget, 10);
        if (!Number.isFinite(budget) || budget < 1) {
          this.toast("请填写有效的思考 Token 预算", "error");
          return;
        }
      }
      const score = this.modelForm.score;
      if (score != null && (score === "" || !Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > 10)) {
        this.toast("推荐评分需为 0 到 10 之间的数字，留空则不展示", "error");
        return;
      }
      const entry = {
        id,
        name: (this.modelForm.name || "").trim(),
        description: (this.modelForm.description || "").trim(),
        score: this.modelForm.score,
        reasoning_effort: mode !== "default" && mode !== "budget" ? mode : null,
        thinking_budget: mode === "budget" ? parseInt(this.modelForm.thinking_budget, 10) : null,
      };
      const oldId =
        this.modelModalIndex !== null ? this.configForm.models[this.modelModalIndex].id : null;
      if (this.modelModalIndex === null) {
        this.configForm.models.push(entry);
      } else {
        this.configForm.models.splice(this.modelModalIndex, 1, entry);
        // 同步更新引用了旧 ID 的默认模型
        if (oldId && this.configForm.default_model === oldId) {
          this.configForm.default_model = id;
        }
      }
      if (!this.configForm.default_model) this.configForm.default_model = id;
      this.modelModalOpen = false;
      this.toast("已更新列表，记得点击“保存配置”生效");
    },

    removeModel(i) {
      const m = this.configForm.models[i];
      if (!m) return;
      if (!confirm(`确定从列表移除模型「${m.name || m.id}」？`)) return;
      this.configForm.models.splice(i, 1);
      if (this.configForm.default_model === m.id) {
        this.configForm.default_model = this.configForm.models[0]?.id || "";
      }
    },

    moveModel(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= this.configForm.models.length) return;
      const arr = this.configForm.models;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    },

    /* ============ 模型拖拽排序 ============ */
    startModelDrag(i, e) {
      this.dragIndex = i;
      this.dragOverIndex = null;
      this.dragOverBefore = false;
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      }
    },

    endModelDrag() {
      this.dragIndex = null;
      this.dragOverIndex = null;
      this.dragOverBefore = false;
    },

    dragModelOver(i, e) {
      if (this.dragIndex === null || i === this.dragIndex) return;
      this.dragOverIndex = i;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      this.dragOverBefore = e.clientY < rect.top + rect.height / 2;
    },

    dragLeaveModel() {
      if (this.dragIndex !== null) this.dragOverIndex = null;
    },

    dropModel() {
      const from = this.dragIndex;
      const to = this.dragOverIndex;
      if (from === null || to === null || from === to) {
        this.endModelDrag();
        return;
      }
      const arr = this.configForm.models;
      const [moved] = arr.splice(from, 1);
      const shifted = to > from ? to - 1 : to;
      const insertAt = this.dragOverBefore ? shifted : shifted + 1;
      arr.splice(insertAt, 0, moved);
      this.endModelDrag();
    },

    setDefaultModel(id) {
      this.configForm.default_model = id;
    },

    async saveConfig() {
      if (!this.configForm.models.length) {
        this.toast("模型列表不能为空，请至少添加一个模型", "error");
        return;
      }
      if (this.defaultModelMissing || !this.configForm.default_model) {
        this.toast("请从模型列表中选择默认模型", "error");
        return;
      }
      this.savingConfig = true;
      try {
        const body = {
          ...this.configForm,
          models: this.configForm.models.map((m) => ({
            id: m.id,
            name: m.name || "",
            description: m.description || "",
            score: m.score ?? null,
            reasoning_effort: m.reasoning_effort || null,
            thinking_budget: m.thinking_budget || null,
          })),
          log_payload: !!this.configForm.log_payload,
          log_retention_days: Math.max(0, Math.floor(Number(this.configForm.log_retention_days) || 0)),
        };
        if (typeof body.llm_api_key === "string" && body.llm_api_key.includes("****")) {
          delete body.llm_api_key;
        }
        if (typeof body.chores_api_key === "string" && body.chores_api_key.includes("****")) {
          delete body.chores_api_key;
        }
        await this.api("/api/admin/config", {
          method: "PUT",
          body: JSON.stringify(body),
        });
        this.toast("配置已保存");
        await this.loadConfig();
      } catch (e) {
        this.toast(e.message || "保存失败", "error");
      } finally {
        this.savingConfig = false;
      }
    },

    /* ============ Provider 聚合 ============ */
    providerHasKey(id) {
      const p = this.providersById[id];
      return !!(p && p.has_api_key);
    },
    providerBoundCount(providerId) {
      let n = 0;
      for (const mid in this.modelProviderMap) {
        if ((this.modelProviderMap[mid] || []).includes(providerId)) n++;
      }
      return n;
    },
    openAddProvider() {
      this.providerForm = { id: "", name: "", base_url: "", api_key: "", enabled: true };
      this.providerModalOpen = true;
    },
    openEditProvider(p) {
      this.providerForm = { id: p.id, name: p.name || "", base_url: p.base_url || "", api_key: p.api_key || "", enabled: !!p.enabled };
      this.providerModalOpen = true;
    },
    async saveProviderModal() {
      const name = (this.providerForm.name || "").trim();
      if (!name) { this.toast("Provider 名称不能为空", "error"); return; }
      const baseUrl = (this.providerForm.base_url || "").trim();
      if (baseUrl && !/^https?:\/\//.test(baseUrl)) { this.toast("Base URL 必须以 http:// 或 https:// 开头", "error"); return; }
      this.savingProvider = true;
      try {
        if (this.providerForm.id) {
          const body = { name, base_url: baseUrl, enabled: !!this.providerForm.enabled };
          if (this.providerForm.api_key && !this.providerForm.api_key.includes("****")) body.api_key = this.providerForm.api_key;
          else if (!this.providerForm.api_key) body.api_key = "";
          // 若包含 **** 则不传 api_key，保持原密钥
          if (body.api_key === undefined || (typeof this.providerForm.api_key === 'string' && this.providerForm.api_key.includes("****"))) {
            delete body.api_key;
          }
          await this.api(`/api/admin/providers/${this.providerForm.id}`, { method: "PATCH", body: JSON.stringify(body) });
          this.toast("Provider 已更新");
        } else {
          await this.api("/api/admin/providers", { method: "POST", body: JSON.stringify({ name, base_url: baseUrl, api_key: (this.providerForm.api_key || "").trim(), enabled: !!this.providerForm.enabled }) });
          this.toast("Provider 已添加");
        }
        this.providerModalOpen = false;
        await this.loadConfig();
      } catch (e) { this.toast(e.message || "保存失败", "error"); }
      finally { this.savingProvider = false; }
    },
    async removeProvider(p) {
      if (!confirm(`确定删除 Provider「${p.name}」(${p.id})？该 Provider 在所有模型的绑定将被同步移除。`)) return;
      try {
        await this.api(`/api/admin/providers/${p.id}`, { method: "DELETE" });
        this.toast("已删除");
        await this.loadConfig();
      } catch (e) { this.toast(e.message || "删除失败", "error"); }
    },
    async toggleProviderEnabled(p) {
      try {
        await this.api(`/api/admin/providers/${p.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !p.enabled }) });
        p.enabled = !p.enabled;
        this.toast(p.enabled ? "已启用" : "已禁用");
      } catch (e) { this.toast(e.message || "更新失败", "error"); }
    },
    openTestProvider(p) {
      const pid = p.id;
      const bound = [];
      for (const mid in this.modelProviderDetails) {
        const arr = this.modelProviderDetails[mid] || [];
        const hit = arr.find(b => b.provider_id === pid);
        if (hit) {
          const m = this.configForm.models.find(x => x.id === mid);
          bound.push({ id: mid, name: m ? (m.name || m.id) : mid, provider_model_id: hit.provider_model_id || mid });
        }
      }
      let defaultModel = "";
      let defaultProviderModelId = "";
      if (bound.length) {
        defaultModel = bound[0].id;
        defaultProviderModelId = bound[0].provider_model_id;
      } else if (this.configForm.models.length) {
        defaultModel = this.configForm.models[0].id;
        defaultProviderModelId = defaultModel;
      }
      this.providerTestForm = { providerId: pid, model: defaultModel, provider_model_id: defaultProviderModelId, prompt: "Hello" };
      this.providerTestModelMenuOpen = false;
      this.providerTestModalOpen = true;
    },
    onProviderTestModelChange(modelId) {
      this.providerTestForm.model = modelId;
      const pid = this.providerTestForm.providerId;
      const details = this.modelProviderDetails[modelId] || [];
      const hit = details.find(b => b.provider_id === pid);
      this.providerTestForm.provider_model_id = hit ? (hit.provider_model_id || modelId) : modelId;
      this.providerTestModelMenuOpen = false;
    },
    get providerTestModels() {
      const pid = this.providerTestForm.providerId;
      if (!pid) return [];
      const bound = [];
      for (const mid in this.modelProviderDetails) {
        const arr = this.modelProviderDetails[mid] || [];
        const hit = arr.find(b => b.provider_id === pid);
        if (hit) {
          const m = this.configForm.models.find(x => x.id === mid);
          bound.push({ id: mid, name: m ? (m.name || m.id) : mid, provider_model_id: hit.provider_model_id || mid });
        }
      }
      if (bound.length) return bound;
      return this.configForm.models.map(m => ({ id: m.id, name: m.name || m.id, provider_model_id: m.id }));
    },
    async confirmTestProvider() {
      const f = this.providerTestForm;
      if (!f.providerId) return;
      const model = (f.model || "").trim();
      if (!model) { this.toast("请选择测试模型", "error"); return; }
      const provider_model_id = (f.provider_model_id || "").trim() || model;
      const prompt = (f.prompt || "").trim() || "Hello";
      this.testingProviderId = f.providerId;
      try {
        const data = await this.api(`/api/admin/providers/${f.providerId}/test`, { method: "POST", body: JSON.stringify({ model, provider_model_id, prompt }) });
        this.toast(`测试成功（${data.latency_ms}ms）[${data.provider_model_id}]: ${(data.output || "").slice(0,80)}`, "ok");
      } catch (e) { this.toast(e.message || "测试失败", "error"); }
      finally { this.testingProviderId = null; }
    },
    // 兼容旧调用（若有外部直接调 testProvider）
    async testProvider(p) { this.openTestProvider(p); },

    /* ============ 模型 Provider 绑定（每模型独立优先级 + per-provider model id） ============ */
    openModelProviders(modelId) {
      const m = this.configForm.models.find(x => x.id === modelId);
      this.modelProvidersModelId = modelId;
      this.modelProvidersModelName = m ? (m.name || m.id) : modelId;
      const details = this.modelProviderDetails[modelId] || [];
      // details 为 [{provider_id, provider_model_id}]
      this.modelProvidersOrdered = details.map(d => ({ provider_id: d.provider_id, provider_model_id: d.provider_model_id || modelId }));
      // 兼容旧 map 若 details 为空但 map 有
      if (!this.modelProvidersOrdered.length && (this.modelProviderMap[modelId] || []).length) {
        this.modelProvidersOrdered = (this.modelProviderMap[modelId] || []).map(pid => ({ provider_id: pid, provider_model_id: modelId }));
      }
      this.modelProvidersDragIndex = null;
      this.modelProvidersDragOverIndex = null;
      this.modelProvidersModalOpen = true;
    },
    toggleModelProvider(pid) {
      const idx = this.modelProvidersOrdered.findIndex(o => o.provider_id === pid);
      if (idx === -1) this.modelProvidersOrdered.push({ provider_id: pid, provider_model_id: this.modelProvidersModelId });
      else this.modelProvidersOrdered.splice(idx, 1);
    },
    isProviderSelected(pid) {
      return this.modelProvidersOrdered.some(o => o.provider_id === pid);
    },
    async saveModelProvidersModal() {
      if (!this.modelProvidersModelId) return;
      // 校验 provider_model_id 非空且长度
      for (const b of this.modelProvidersOrdered) {
        const pmid = (b.provider_model_id || "").trim();
        if (!pmid) { this.toast("Provider 模型 ID 不能为空", "error"); return; }
        if (pmid.length > 256) { this.toast("Provider 模型 ID 过长", "error"); return; }
      }
      this.savingModelProviders = true;
      try {
        const bindings = this.modelProvidersOrdered.map(o => ({ provider_id: o.provider_id, provider_model_id: (o.provider_model_id || "").trim() || this.modelProvidersModelId }));
        await this.api(`/api/admin/models/${encodeURIComponent(this.modelProvidersModelId)}/providers`, {
          method: "PUT",
          body: JSON.stringify({ bindings }),
        });
        // 本地更新 map 与 details
        const pids = bindings.map(b => b.provider_id);
        this.modelProviderMap[this.modelProvidersModelId] = [...pids];
        this.modelProviderDetails[this.modelProvidersModelId] = bindings.map((b, i) => ({ provider_id: b.provider_id, provider_model_id: b.provider_model_id, priority: i }));
        this.modelProviderMap = { ...this.modelProviderMap };
        this.modelProviderDetails = { ...this.modelProviderDetails };
        this.modelProvidersModalOpen = false;
        this.toast("优先级已保存");
      } catch (e) { this.toast(e.message || "保存失败", "error"); }
      finally { this.savingModelProviders = false; }
    },
    startModelProvidersDrag(idx, e) {
      this.modelProvidersDragIndex = idx;
      this.modelProvidersDragOverIndex = null;
      if (e && e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); }
    },
    endModelProvidersDrag() {
      this.modelProvidersDragIndex = null;
      this.modelProvidersDragOverIndex = null;
    },
    dragModelProvidersOver(idx, e) {
      if (this.modelProvidersDragIndex === null || idx === this.modelProvidersDragIndex) return;
      this.modelProvidersDragOverIndex = idx;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = "move";
    },
    dropModelProviders() {
      const from = this.modelProvidersDragIndex;
      const to = this.modelProvidersDragOverIndex;
      if (from === null || to === null || from === to) { this.endModelProvidersDrag(); return; }
      const arr = this.modelProvidersOrdered;
      const [moved] = arr.splice(from, 1);
      const insertAt = to > from ? to : to;
      // 根据拖拽方向决定插入前后：简化为插入到目标位置之前
      // 若拖动时从上往下，目标索引已因 splice 前移一位，处理与模型拖拽一致
      const shifted = to > from ? to - 1 : to;
      arr.splice(shifted, 0, moved);
      // 若是直接 drop 到目标项上（未计算 before/after），上面 shifted 逻辑已处理
      // 为兼容未精确 before/after 的情况，若 from<to 则把 moved 放到 shifted+1
      // 这里保持简单：若 from<to 则已在 shifted，符合前移预期
      this.endModelProvidersDrag();
    },

    /* 模型表格内 Provider 拖拽（每模型独立） */
    startProviderDrag(modelId, idx, e) {
      this.providerDragModelId = modelId;
      this.providerDragIndex = idx;
      this.providerDragOverIndex = null;
      if (e && e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(idx)); }
    },
    endProviderDrag() {
      this.providerDragModelId = null;
      this.providerDragIndex = null;
      this.providerDragOverIndex = null;
    },
    dragProviderOver(modelId, idx, e) {
      if (this.providerDragModelId !== modelId || this.providerDragIndex === null || idx === this.providerDragIndex) return;
      this.providerDragOverIndex = idx;
      if (e && e.dataTransfer) e.dataTransfer.dropEffect = "move";
    },
    dragLeaveProvider() {
      if (this.providerDragModelId !== null) this.providerDragOverIndex = null;
    },
    async dropProvider(modelId) {
      const from = this.providerDragIndex;
      const to = this.providerDragOverIndex;
      const mid = this.providerDragModelId;
      if (from === null || to === null || mid !== modelId || from === to) { this.endProviderDrag(); return; }
      // 优先操作 details（含 provider_model_id），回退到 map
      const srcDetails = this.modelProviderDetails[modelId];
      if (srcDetails && srcDetails.length) {
        const arr = [...srcDetails];
        const [moved] = arr.splice(from, 1);
        const shifted = to > from ? to - 1 : to;
        arr.splice(shifted, 0, moved);
        this.modelProviderDetails[modelId] = arr;
        this.modelProviderDetails = { ...this.modelProviderDetails };
        this.modelProviderMap[modelId] = arr.map(o => o.provider_id);
        this.modelProviderMap = { ...this.modelProviderMap };
        this.endProviderDrag();
        try {
          const bindings = arr.map(o => ({ provider_id: o.provider_id, provider_model_id: o.provider_model_id || modelId }));
          await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
            method: "PUT",
            body: JSON.stringify({ bindings }),
          });
          this.toast("优先级已更新");
        } catch (e) { this.toast(e.message || "保存优先级失败", "error"); await this.loadConfig(); }
        return;
      }
      const arr = [...(this.modelProviderMap[modelId] || [])];
      const [moved] = arr.splice(from, 1);
      const shifted = to > from ? to - 1 : to;
      arr.splice(shifted, 0, moved);
      this.modelProviderMap[modelId] = arr;
      this.modelProviderMap = { ...this.modelProviderMap };
      this.endProviderDrag();
      try {
        await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
          method: "PUT",
          body: JSON.stringify({ ordered_provider_ids: arr }),
        });
        this.toast("优先级已更新");
      } catch (e) { this.toast(e.message || "保存优先级失败", "error"); await this.loadConfig(); }
    },
    async moveProviderInModel(modelId, idx, dir) {
      const details = this.modelProviderDetails[modelId];
      if (details && details.length) {
        const j = idx + dir;
        if (j < 0 || j >= details.length) return;
        const arr = [...details];
        [arr[idx], arr[j]] = [arr[j], arr[idx]];
        this.modelProviderDetails[modelId] = arr;
        this.modelProviderDetails = { ...this.modelProviderDetails };
        this.modelProviderMap[modelId] = arr.map(o => o.provider_id);
        this.modelProviderMap = { ...this.modelProviderMap };
        try {
          const bindings = arr.map(o => ({ provider_id: o.provider_id, provider_model_id: o.provider_model_id || modelId }));
          await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
            method: "PUT",
            body: JSON.stringify({ bindings }),
          });
          this.toast("优先级已更新");
        } catch (e) { this.toast(e.message || "保存失败", "error"); await this.loadConfig(); }
        return;
      }
      const arr = [...(this.modelProviderMap[modelId] || [])];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      this.modelProviderMap[modelId] = arr;
      this.modelProviderMap = { ...this.modelProviderMap };
      try {
        await this.api(`/api/admin/models/${encodeURIComponent(modelId)}/providers`, {
          method: "PUT",
          body: JSON.stringify({ ordered_provider_ids: arr }),
        });
        this.toast("优先级已更新");
      } catch (e) { this.toast(e.message || "保存失败", "error"); await this.loadConfig(); }
    },
    moveModelProviderOrdered(idx, dir) {
      const j = idx + dir;
      if (j < 0 || j >= this.modelProvidersOrdered.length) return;
      const arr = this.modelProvidersOrdered;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
    },
  };
}
