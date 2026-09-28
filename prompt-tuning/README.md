# Prompt 调优工作台

## ⚠️ 动手前必读（顺序别跳）

1. **Prompt Engineering Guide** —— 核心方法论，任何 prompt 改动前必读。本仓库内副本：`prompt教学教程分析类文章/prompt engineering guide.md`（未入库；若本地没有，向用户索取）。
2. **`prompt-tuning/LOCAL-NOTES.md`** —— 模型/API 使用规则与个人偏好（含"只能用用户批准过的模型""key 的适用范围"等硬约束）。**未入库**，只在本机；若不存在，先问用户。
3. 本文件，尤其是第三节「经验教训」。

---

一套可复用的 prompt 调优工具与流程。核心范式：**让 judge 找出问题 → 改 prompt → 重新生成 → 再 judge → 循环到收敛**，全程用数据说话。

目前已完成一个 prompt 的调优（`智能错题迁移`，v0 → v17），其余 prompt 尚未处理。

---

## 一、目录结构

```
prompt-tuning/
├─ README.md                    本文件：方法论 + 操作手册
├─ .gitignore                   只挡「密钥配置」和「原始产物」
├─ pyproject.toml / uv.lock      依赖（httpx、pillow 等）
├─ config/                      模型配置
│   ├─ api_config.example.json   模板（入库）
│   ├─ api_config.json           真实配置（**忽略**，含 key）
│   ├─ scorer_config.example.json / scorer_config.json   免费评分器（respan）
│   └─ jev_config.example.json   / jev_config.json       官方 Jev（Command Code）
├─ scripts/                     全部工具（与具体 prompt 无关）
│   ├─ paths.py                 路径解析：--suite 决定读写哪个 suite/run
│   ├─ gen.py solve.py strip.py  生成 / 盲测解题 / 切出 blind 版
│   ├─ check.py qparse.py        结构完整性检查 + 输出解析库
│   ├─ leak_check.py             方法论-题干泄漏查重
│   ├─ hack_check.py             邪修捷径检测（词族角色/选项组复用/题干模板）
│   ├─ cue_check.py              表面线索（绝对化词/长度）
│   ├─ slot_check.py             槽位角色（正确项字母、干扰类型分布）
│   ├─ judge.py                  多视角评审（教师 + 三类学生人设，rubric 在 rubrics/）
│   ├─ scorer.py                 窄问题评分器（Jev 格式，7 项检查）
│   ├─ pipeline.py               逐选项流水线评分（可填性/凑数项/三类难度负荷）
│   ├─ ab_test.py ab_tally.py    匿名 A/B 配对盲评 + 汇总
│   ├─ ab_aspect.py              单维度盲评（正反双顺序，只认一致票）
│   └─ blind_student.py          多模型盲做统计
├─ rubrics/                     通用评审 rubric（teacher_judge.md / student_judge.md）
├─ suites/                      每个被调优的 prompt 一个子目录（**全部入库**）
│   ├─ _template/cases.json      新 suite 起手模板
│   └─ 智能错题迁移/
│       ├─ cases.json            案例库（原题 + 答案 + 学生错答 + 已确认错因）
│       ├─ prompt/               版本记录 v0..v17（当前生产版在仓库根 prompts/ 下）
│       ├─ notes.md              失败样例库（v0-v17 全部实锤问题与修复对应）
│       ├─ report.md             调优报告（数据、结论、遗留问题）
│       └─ report.html           面向用户的分页报告（新粗野主义，每页 1280×800）
└─ runs/                        原始产物（**忽略**）
    └─ <suite>/{outputs/, work/}  生成结果、评分/盲评/检测结果
```

所有脚本从 `scripts/` 运行，读写自动落到 `runs/<suite>/`：

```bash
cd prompt-tuning
uv sync                                     # 首次
uv run python scripts/check.py --round v17   # suite 唯一时自动识别
uv run python scripts/check.py --round v17 --suite 智能错题迁移   # 多 suite 时显式指定
```

---

## 二、新建一个 prompt 的调优（完整流程）

### 0. 前置准备
1. 把生产 prompt 路径记下来（调优只改**副本**，最后再回写）。
2. 准备**模型配置**：`config/api_config.json`（生成 + 评审池）、`config/scorer_config.json`（respan，免费）、`config/jev_config.json`（typesafe/jev）。

### 1. 建 suite
```bash
cp -r suites/_template suites/<prompt名>
# 编辑 suites/<prompt名>/cases.json：写 4-6 个真实案例，覆盖该 prompt 的主要题型/场景
```
案例字段：`question`（原题逐字照录）、`standard_answer`、`student_answers`、`cause`（已确认的本质错因，一句话讲清机制）。
**要点：案例要覆盖该 prompt 的全部典型失败模式**，否则 judge 找不到问题（我们的经验：6 个案例 × 4 档位足够暴露主要问题，覆盖不足会误判"已收敛"）。

### 2. 准备 prompt 版本
在 `suites/<prompt名>/prompt/` 下放迭代版本：`v0.md` = 当前生产版（基线）。

### 3. 一轮循环（改 → 测 → 评 → 再改）
```bash
# ① 生成（每轮 6 案例 × 档位 1/3/5/10 = 24 份，约 10-20 分钟）
uv run python scripts/gen.py --round v2 --prompt suites/x/prompt/v2.md --counts 1,3,5,10

# ② 客观指标（秒级，无 API）
uv run python scripts/check.py     --round v2      # 结构完整性
uv run python scripts/leak_check.py --round v2     # 方法论泄题
uv run python scripts/hack_check.py --round v2     # 可归纳捷径
uv run python scripts/cue_check.py  --round v2     # 表面线索
uv run python scripts/slot_check.py --round v2     # 槽位分工

# ③ 盲测解题（交叉验证答案正确性，约 10 分钟）
uv run python scripts/strip.py --round v2          # 生成 blind/（无答案版）
uv run python scripts/solve.py --round v2

# ④ 决策模型评分（快、便宜，可全量）
uv run python scripts/scorer.py   --rounds v2 --config jev_config.json
uv run python scripts/pipeline.py --rounds v2 --config jev_config.json

# ⑤ 单维度盲评（版本对比的主力仪器）
uv run python scripts/ab_aspect.py --round-a v2 --round-b v0 --aspects transfer,deception,overall

# ⑥ 多视角评审（较慢，抽样子集即可）
uv run python scripts/judge.py --round v2 --teacher --students --student-counts 01,10
```

### 4. 合并结论、改 prompt
- 每轮把问题**写进 `notes.md`**（失败样例库）：`[版本] 案例/题位 — 问题 — 证据`，并标注修复对应关系。
- 只改**被证据支持**的地方。改完记录在案，进入下一轮。

### 5. 收敛判定
- 客观：结构全绿、泄漏 0、盲测不一致 ≲2%、捷径检测 ≤1 个文件
- 主观：单维度盲评对比上一版**不显著变差**（打平或更好）
- 强模型/决策模型都判"打平"且机械指标无残留 → 可以停

### 6. 定稿
1. 最新版本回写生产 prompt 文件。
2. 更新 `report.md`（数据表 + 结论 + 遗留问题）与 `report.html`（分页报告）。
3. 等用户确认后提交。

---

## 三、经验教训（血泪版，新会话务必先读）

### 关于写 prompt
1. **规则通胀是最大陷阱**。加的规则越多，模型越"一板一眼执行所有规则"，反而暴露新问题（我们经历过：每修一个问题就冒出一个新问题）。**规则总量要控制，超出 8-10KB 就该考虑把细则外移到 verifier**。
2. **结构性约束 > 禁止性措辞**。"禁止 X"会被模型换个形态绕过（我们的"方法论不许举例泄题"被绕过两次，最后用"**先写方法论并锁定**"的生成顺序约束一次解决）。
3. **过信息论测试**：每句话自问"删掉它，模型会猜错吗"。通不过的删掉——重复句、解释性尾巴、靠"数一遍"撑着的自查都该删。
4. **先写规则、后写例外**：给一条硬规则时想清楚它在**极小样本**下是否可定义（我们在"至少 2 题…"这类配额上踩过坑：题量=1 时不可能成立，必须加题量守卫）。
5. **不同 prompt 共享同一套骨架**：任务与意图 → 上下文 → 约束与边界 → 输出契约 → 例外处理。改的时候别推翻已验证的部分，做增删改。

### 关于测
6. **三类证据要齐**：决策模型评分（快、可全量）、单维度盲评（版本对比主力）、机械检测（不受评审偏好影响）。缺了机械检测会漏掉"学生能机械利用的规律"，缺了盲评会漏掉"整体观感"。
7. **两台独立仪器交叉验证**：报告配对题的 Pearson r；r ≥0.5 才谈得上可信。两仪器的**绝对水平可能差很多**（同一项差过 14 倍），只做同仪器内的版本对比。
8. **单维度 + 正反双顺序**是控制位置偏差的关键：一个维度一次提问、A/B 顺序对调、两次矛盾记无效票。矛盾率高（>30%）说明两版太接近，结论只能记"打平"。
9. **决策模型只适合窄问题**（这是它的特性，不是缺陷）：把"这道题好不好"拆成 7-14 个二值/选择判定，别问需要多步推理的问题。
10. **验证自动化本身**：解析器/指标算错会让结论反向（我们踩过：`^` 没加 re.M 导致选项一条没读到，得出"零问题"的假阴性）。新脚本先在小样本上与人工核对。

### 关于 prompt 质量的经验性发现（可迁移到其他 prompt）
11. **"对的太对、错的太错"要用双通道验证治**：要求"凭应试直觉做必须错或犹豫"，比一条条规定干扰项形态有效。
12. **"邪修"专治**：让模型扮演"不懂考点、只找规律"的学生，能把可背诵配方挖出来（它能在原版上通杀、在改后只能靠语义阅读）。机械检测对应：词族角色固话、"永远只错"的词、选项组复用、题干模板、长度线索、字母/槽位分工。
13. **量化自查不可靠**：让模型"数一遍"（出现 ≥2 次必须对过一次…）仍有 3-5% 抽样失败率。这类检查属于**生成后的质量门禁**（未来 verifier 阶段），不要指望 prompt 内自查。
14. **同一考点在题组内要换词实现 + 角色双向**，否则学生"见了就排除"照样白拿分。

### 关于环境与成本
15. **限流**：长时间并发跑 judge 会被 524，把并发降到 2-4、失败重试、结果**逐条落盘**（所有脚本都支持断点续跑，重跑自动跳过已完成）。
16. **推理模型的 max_tokens**：reasoning token 计入预算，4096 会让输出为空。生成用 ≥32768（我们测试用 65536）。
17. **密钥**：`config/*.json` 全部 gitignore，只入库 `.example.json`。提交前扫一遍 `git log --all -p | grep <key片段>` 确认历史干净。
18. **内置浏览器截图**：`clip` 参数会产生平铺伪影，用 `setViewportSize` + 视口截图。要做分页报告就用固定尺寸的 `.page`（每页一个截图单元）。

---

## 四、脚本速查

| 脚本 | 作用 | 关键参数 | 速度/成本 |
|---|---|---|---|
| `gen.py` | 按模板生成 N 份结果 | `--prompt --counts --cases` | 慢（推理模型 1-5 分钟/份） |
| `check.py` | 结构完整性（标题/题数/题号/答案/选项/指纹重叠） | `--round` | 秒级，免费 |
| `leak_check.py` | 方法论与题干的 n-gram 泄漏 | `--round` | 秒级 |
| `hack_check.py` | 可归纳捷径（角色固化/选项组复用/模板） | `--round` | 秒级 |
| `cue_check.py` | 表面线索（绝对化词、长度） | `--round` | 秒级 |
| `slot_check.py` | 槽位角色分布 | `--round` | 秒级 |
| `strip.py` / `solve.py` | 切无答案版 / 盲测解题 | `--round` | 中（每份一次调用） |
| `scorer.py` | 8 项窄问题评分（Jev 格式） | `--rounds --config` | 快（每题 1 次，免费~极廉） |
| `pipeline.py` | 逐选项流水线评分 | `--rounds --config` | 快（每题 3 次） |
| `ab_aspect.py` | 单维度盲评（正反双顺序） | `--round-a --round-b --aspects` | 中（每对 3 维度 × 2 次） |
| `ab_test.py` / `ab_tally.py` | 匿名 A/B 配对盲评 + 汇总 | `--round-a --round-b --reps` | 慢（聊天模型被限流） |
| `judge.py` | 教师 + 学生人设多视角评审 | `--teacher --students --student-counts` | 慢 |
| `blind_student.py` | 多模型盲做统计 | `--round --files` | 中 |
| `paths.py` | 路径解析（被其他脚本 import） | `--suite` | — |

---

## 五、当前进度

| Prompt | 状态 | 说明 |
|---|---|---|
| 智能错题迁移 | ✅ 已调优（v0→v17） | 生产文件 `prompts/智能错题迁移.md`；细节见 `suites/智能错题迁移/{notes,report}.md` |
| 其他 prompt | ⬜ 待开始 | 仓库 `prompts/` 下还有 30+ 个（试卷可视化全解、错题错因分析、作文批改、各类教学设计等） |

### 已知待办（与调优无关但相关）
- 生产后端 `config.py` 默认 `max_tokens=4096`：对推理模型会导致空输出，建议 ≥32768。
- 四个机械检测脚本可作为**生成后的质量门禁**接入后端（未来 verifier 阶段）。
