# ba-click-fx 性能补丁台账（NeoBangX 分支）

本文件记录对上游 `ba-click-fx.js`（v1.3.3，MIT，© CialloKing）施加的全部性能补丁。
**目的**：视觉效果逐位不变的前提下，消除每帧冗余计算与对象分配。

- 上游基线：v1.3.3，原文件 md5 `800dd880...`（git tag/提交 `30537ac` 引入时的版本）
- 本文件与库同目录存放；`frontend/` 与 `admin-frontend/` 两份拷贝**逐字节相同**，升级任一端时必须同步两端
- 升级上游新版本时的流程：替换库文件 → 对照下表逐条重放补丁（改动均为局部、幂等）→ 同步两端 → 提升 `click-fx.js` 里的版本号（当前 `?v=fxlib133p2`）→ 运行 `node --test frontend/tests/click-fx-performance.test.js`，并检查渲染路径
- 每处补丁在代码内均有 `[NBX-PERF-x]` 中文注释标记，与本表编号对应

## 无损性总则

| 级别 | 含义 |
|---|---|
| Tier 1 | 缓存/复用「同输入必同输出」的计算：可数学论证输出逐字节一致 |
| Tier 2 | 精确键 memo：键完整覆盖输入，只做「完全相同才命中」，无任何量化近似 |

明确**不做**的事项（会破坏无损或收益低）：512² tint 缓存键量化、软件 bloom 区域合并的
Set 化（改变合并顺序可能改变区域矩形）、跨类别 draw call 合批、降低输入采样率、
任何降低画质/粒子数的改动。

## 补丁清单

### A. 拖尾测量缓存（Tier 1）

- 位置：`_updateTrail`（约 :7189）、`_startTrailStroke`（:6235）、`_appendPointerSample`（:6264）、
  `_ensureCurrentTrailStroke`、`_commitFxParamConfig`（:6075）、构造函数（:5716/:5718）、
  `_applyThemeColor` / `setThemeColorMode`
- 改动：`Co()`（拖尾几何/能量测量，纯函数）的结果按四元组缓存键复用：
  `pointsVersion : _fxConfigVersion : _themeVersion : emission模式`。
  points 的每次变更（splice/append/重置）递增 stroke 的 `pointsVersion`；
  fxConfig 提交与主题切换各有一个版本戳。
- 为什么无损：`Co` 是 `(points, trail 配置, emission, 相对 oklch 主题 K)` 的纯函数
  （`Co → wo → To → _a` 读取模块级 `K`，故主题必须进键——这是最容易漏的失效路径）。
  四者不变时重算结果逐字节相同。
- 收益：指针静止或采样间隔内的帧不再重算；消除每帧数百次小数组/map/闭包分配。
- 失效条件：新增 points 变更点时必须同步递增 `pointsVersion`；
  新增 fxConfig/主题赋值点时必须放进对应版本戳。

### B. fxConfig 序列化缓存（Tier 1）

- 位置：`_getSoftwareBloomFrameSignature`（约 :6862）、`_commitFxParamConfig`（:6075）
- 改动：`JSON.stringify(this.fxConfig)` 结果缓存，仅配置提交时作废。
- 为什么无损：同一字符串。该函数每帧被调用 2~3 次（仅软件 bloom 路径）。
- 注意：签名的其余部分（粒子状态、主题）本就逐帧变化，未动。

### C. WebGL2 uniform location 查表缓存（Tier 1）

- 位置：`Cr` 构造函数（:2739）、`Cr._uloc`（:3170）、`Cr._forgetResourceReferences`（:2800）、
  `gi` 构造函数、`gi._uloc`（:4068）、`gi._deleteResources`；
  替换 `Cr` 内 `_drawTexturedAdditiveBatch`/`_drawGeometryBatches`/`_bindTexture`/
  `_renderPrefilter`/`_renderDownsample`/`_renderUpsample`/`_renderFinal` 与
  `gi` 内 coverage/final pass 的全部 `getUniformLocation` 调用
- 改动：program 创建后 location 稳定，查询结果按 program 缓存进实例级 Map。
- 为什么无损：传给 GL 的 uniform 值与调用序列完全一致（含未使用 uniform 的 null）。
  context 丢失重建时 program 重建、Map 随之作废。
- 收益：每帧省 30~60 次驱动往返查询。
- 失效条件：新增 draw pass 时统一走 `this._uloc(program, name)`，不要直接
  `getUniformLocation`。

### D. 每帧分配改池化 scratch（Tier 1）

- 位置：`vi()`（:4261，钳制缓冲）、`addDissolveRing`（:3115，弧线 sin/cos 双缓冲）、
  `_angularMassScratch`（:7075，角质量缓冲池）、`_drawNativeClickBloom` 盘/环双循环
  （:7095/:7109/:7118，颜色三元组）、构造函数（:2721/:5721）
- 改动：`new Float64Array`/`new Float64Array(64)`/每像素 `map` 分配改为实例级或
  模块级 scratch，按需扩容；`angularMass` 取出即 `fill(0)`，与零初始化语义一致；
  `Math.max(...arr)` 展开改顺序比较。
- 为什么无损：写入/读出的数值序列与运算顺序不变；`Q()` 恒返回 3 元素颜色三元组，
  scratch 长度匹配。
- 收益：Canvas2D/原生辉光路径每帧消除数百至上千次小对象分配（GC 暂停的主要来源）。

### E. visual-max 逐像素去分配（Tier 1）

- 位置：`l()`（:22，新增可选输出参数，不传时行为不变）、`u()`（:51）、`d()`（:85）
- 改动：每像素的输入/输出三元组与 `l()` 内部中间数组改复用模块级 scratch；
  `Math.max(...u)` 展开改标量比较。
- 为什么无损：相同输入相同输出；仅在 `browser-overlay + 未知浏览器 + visual-max`
  策略下触发。
- 失效条件：`l()` 的其他调用方（不传第 4 参）自动保持原行为。

### G. 循环不变量提升（Tier 1）

- 位置：`_nbxStrokeVisible`（:5283）、`_hasVisibleEffects`、`_updateWaves`（:7201）、
  `_updateShards`（:7216）
- 改动：`some` 回调闭包提为模块级函数；`_getCanvasOutputCompositing()` /
  `_getEffectiveOpacity()` / `_getEffectiveOverlayAlphaLimit()` 提到粒子循环外求值。
- 为什么无损：三个 getter 只读实例配置/派生状态，帧内恒定；布尔与参数值不变。

### F（已评估并撤回，记录备查）

- 原计划：GPU 特效路径跳过 2D canvas 的全屏 `clearRect`。
- 撤回原因：构造时（:5683 附近）GPU 路径下 `this.context` 根本不会创建
  （`Da(canvas)` 为真且 effectBackend 非 canvas2d 时 `context = null`），纯 GPU 路径
  该 clear 本就是 no-op；而混合路径（GPU 失败回退 Canvas2D 后再恢复）里 2D canvas
  依然可见，这个 clear 是防止残影的承重墙。结论：无收益且风险实在，保持原样。

### H. WebGPU uniform 暂存区复用（Tier 1）

- 位置：`ai._createPassUniform`、`ai._writeGeometryUniform`。
- 改动：每个 renderer 分别复用 96 字节 pass 与 32 字节 geometry 暂存区及其 typed array 视图。
- 无损依据：每次写入覆盖所有已用字段，geometry 对齐填充保持初始零值；所有调用方在下一次复用前立即调用 `queue.writeBuffer`。
  [WebGPU 规范](https://gpuweb.github.io/gpuweb/#dom-gpuqueue-writebuffer)规定在 content timeline 复制源数据，后续复用不会修改已提交内容。
- 升级注意：若增加字段或调用方开始跨调用保留返回缓冲，必须重新检查覆盖范围和暂存区寿命。

### I. WebGPU bind group 与 geometry texture view 复用（Tier 2）

- 位置：`ai._nbxBindGroupSlot`、`_createGeometryBindGroup`、`_createFullscreenBindGroup`、`_deleteTargets`。
- 键：pipeline / uniform 对象分桶，设备、sampler 与全部纹理或视图引用逐一比较；uniform 内容变化无需重建绑定。
- 每个分桶只保留最新一组 geometry / fullscreen 绑定，WeakMap 不永久保留旧 pipeline 和 uniform；释放目标时清空所有缓存。
- resize、后端切换、销毁沿原 `_deleteTargets` 路径释放引用；替换设备或任一绑定资源都会重新创建。
- 不缓存每帧的 swapchain 输出视图，不改变 pass 顺序、draw call、shader 或采样参数。

### J. 幂等 resize 与接入层重复调用消除（Tier 1）

- 位置：`Xo._resize`；两端 `click-fx.js` 的 `restorePristine` 与 maxDpr 降级分支。
- 仅当逻辑尺寸、DPR、主画布和对比画布实际像素尺寸均一致时跳过画布重置；外部修改尺寸仍会恢复。
- `updateConfig({maxDpr})` 本身已调用 `_resize`，接入层移除其后的第二次 `resize()`；缩放和降级数值不变。

## p2 验证

- `frontend/tests/click-fx-performance.test.js` 覆盖 uniform 原始字节布局与默认值恢复、绑定键各维度失效、资源释放、尺寸/DPR 变化及两端文件同步。
- 稳定资源连续调用 1000 次只创建一次 bind group / geometry texture view；这衡量 API 调用消除，不等价于实际 FPS 提升比例。
- GPU 像素级实测未执行；收益主要是 CPU 分配与驱动对象创建开销，不宣称降低 shader 像素工作量。

## 历史验证记录（p1）

- `node --check` 两份库：通过
- 无头冒烟测试 `.tmp-shots/fx-smoke.mjs`（Node + DOM 打桩，Canvas2D 全路径跑帧）：
  补丁版全部通过；原版对照恰好失败 2 项缓存命中断言（预期差异）
  - 覆盖：实例创建、点击波/碎片/圆环/原生辉光/拖尾绘制循环、补丁 A 的命中与
    三类失效（points / 主题 / 配置）、运行期零库自身错误
- 后端：`uv run pytest` 230 passed（含新增 `test_static_cache.py` 16 断言）
