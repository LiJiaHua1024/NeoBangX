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
    logCode: "",
    logToolId: "",
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
    },
    hasLlmKey: false,
    hasChoresKey: false,
    savingConfig: false,
    defaultModelMenuOpen: false,
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
        if (this.tab === "config") await this.loadConfig();
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

    async loadLogs() {
      try {
        const params = new URLSearchParams({
          page: String(this.logsPage),
          page_size: String(this.logsPageSize),
        });
        if (this.logCode.trim()) params.set("code", this.logCode.trim());
        if (this.logToolId.trim()) params.set("tool_id", this.logToolId.trim());
        const data = await this.api(`/api/admin/logs?${params}`);
        this.logs = data.items || [];
        this.logsTotal = data.total || 0;
      } catch (e) {
        this.toast(e.message || "加载日志失败", "error");
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
        };
        this.hasLlmKey = !!data.has_llm_api_key;
        this.hasChoresKey = !!data.has_chores_api_key;
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
  };
}
