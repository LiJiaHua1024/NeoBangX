"""内容模板：按场景与工具产出「看起来像真的」的模型输出。

内置模板故意覆盖前端渲染的全部分支：标题层级、列表、表格、加粗、行内/块级
KaTeX、引用、代码块，以及试卷工具的 @@TAG@@ 契约格式。
"""

from __future__ import annotations

import json
from typing import Any

from mock_backend import paper as paper_mod
from mock_backend.scenarios import StreamPlan

# 通用课件正文：覆盖 Markdown 渲染的主要语法分支
_GENERIC = """## 一、语篇主题与文体定位

这篇文章是一篇**说明性语篇**，作者围绕「城市绿廊对微气候的调节作用」展开，面向普通读者，因此语言在准确与通俗之间做了平衡。全文呈「现象—机制—对策」的推进结构，段落之间靠回指与同义复现衔接。

行文有三个值得注意的特点：

1. **抽象名词短语作主语**（如 *the regulation of urban microclimate*），使论述更显客观；
2. 被动语态密集，把动作承受者放在句首，突出「被调节的对象」；
3. 每段末句承担过渡功能，预告下一段的论述方向。

## 二、语言点讲解

### 1. mitigate 与 alleviate 的辨析

两者都译作「缓解」，但**侧重点不同**：

| 词 | 核心语义 | 典型搭配 | 语体 |
| --- | --- | --- | --- |
| mitigate | 使严重性下降 | mitigate the impact / risk | 正式，多用于政策与学术 |
| alleviate | 使痛苦、压力变得可承受 | alleviate pain / congestion | 通用，偏具体感受 |
| relieve | 暂时解除 | relieve pressure / symptoms | 通用，偏即时 |

原文用 *mitigate* 而不是 *alleviate*，是因为作者讨论的是**可量化的气候指标**，而非人的主观感受——选词本身就划定了论述的学科边界。

### 2. 一个值得拆解的长句

> Cities that once treated trees as decoration now regard them as **infrastructure**, a shift that reorders how municipal budgets are argued for in council chambers.

句子的主干是 *Cities ... now regard them as infrastructure*；*that once treated trees as decoration* 是限制性定语从句，暗含「今昔对比」；*a shift that ...* 是同位语，把前面的认知转变重新编码成一个可被讨论的对象。

### 3. 公式化的论证套路

作者在第三段使用了一个可迁移的论证模板：

$$\\text{现象} \\Rightarrow \\text{机制} \\Rightarrow \\text{可验证指标}$$

其中「可验证指标」一段最值得学生学习：它把抽象的「更舒适」转成了 *a 2.3°C reduction in surface temperature*，让主张变得可检验。

## 三、教学建议

- 让学生先用一句话概括每段功能，再回头对照作者的衔接手段，比直接讲术语更有效；
- 把 *mitigate / alleviate / relieve* 三个词放进同一道语篇填空，用语境强制区分；
- 长句分析宜放在第二课时，先用「划主干」的方式降低认知负荷。

```text
教学流程建议
第 1 课时  主题定位 + 结构梳理
第 2 课时  语言点精讲 + 长句拆解
第 3 课时  写作迁移（仿写论证段）
```

> 一句话总结：这篇语篇的价值不在生词，而在它示范了「如何把一个日常观察讲成一项有数据的论证」。
"""

# 超长正文：跨过前端的折叠阈值，用于测「查看更多」与渲染性能
_LONG_INTRO = """## 长文输出压力测试

本段由假后端生成，用于验证前端在超长输出下的折叠、滚动与渲染性能。内容为可复现的重复结构，不含任何真实调用。

"""


def _long() -> str:
    parts = [_LONG_INTRO]
    for i in range(1, 13):
        parts.append(f"""### 第 {i} 节：论证模板 {i}

本节的论述结构与上一节同构，仅替换例证。学生在迁移时应当注意：**模板可以复用，例证必须更换**。

| 维度 | 本节处理方式 | 常见错误 |
| --- | --- | --- |
| 论点 | 放在段首第一句 | 把论点埋在段中 |
| 例证 | 一条具体数据 + 一个生活场景 | 只有抽象描述 |
| 衔接 | 段末回指上节结论 | 换题不换衔接词 |

第 {i} 节的核心句式：*What matters is not X itself, but the way X is framed.*

$$E_{{{i}}} = \\sum_{{k=1}}^{{n}} w_k \\cdot f_k(x)$$

""")
    parts.append("> 以上共 12 节，若前端折叠阈值正常，长文应被折叠并可展开。\n")
    return "".join(parts)


_MIGRATION = """## 错因定位：{cause}

### 一、错因本质

学生在这类题上失分，表面看是**细节没看清**，本质是**没有建立「题干关键词 → 原文定位」的反射**。他习惯从选项出发倒推原文，而不是先依据题干在原文中划出可验证的区间，于是被「原词重现」的干扰项牵着走。

### 二、讲懂方法

定位型题目有一个固定的三步动作：

1. **划关键词**：从题干里挑出**唯一性最高**的词（专有名词、数字、极端词），而不是挑自己认识的词；
2. **定区间**：带关键词回原文，只读该词出现处前后各一句，超出范围的一律不看；
3. **比对**：把区间内的表述与选项逐词比对，**同义改写才算对，原词重复往往是坑**。

$$P(\\text{正确}) \\approx P(\\text{关键词唯一}) \\times P(\\text{区间内完成比对})$$

### 三、迁移练习

**练习 1**（同等难度）

阅读下面段落，回答题 1。

Most nocturnal migrants do not fly at a constant altitude. Radar records show that a bird crossing a plain may climb or descend by several hundred metres within an hour, adjusting to temperature layers and wind shear. What appears from the ground as a straight course is, in the vertical dimension, a series of small corrections.

1. What does the author suggest about nocturnal migrants?

A. They keep a steady height throughout the flight.
B. They make frequent small adjustments in altitude.
C. They rely mainly on wind direction to stay on course.
D. They avoid crossing plains when temperatures drop.

**答案与解析**

答案：**B**。依据第二句中的 *climb or descend by several hundred metres within an hour* 与 *a series of small corrections*，B 项是对这两处的同义概括。A 项与 *do not fly at a constant altitude* 直接矛盾；C 项把 *adjusting to ... wind shear* 偷换成「依赖风向定向」；D 项在原文中没有对应信息，属于无中生有。

**练习 2**（变式：选项设置干扰）

把上题的 C 项改为 *They change altitude mainly to follow temperature layers*，请说明此时它为何仍是干扰项。

> 讲评提示：它确实出现了原文信息，但 *mainly* 一词把「其中一个原因」放大成「主要原因」，属于**程度失真**——这是命题最常用的干扰手法。
"""

_VOCAB = """## 超标词替换结果

共排查并替换 {replaced} 个超标词，逐条对照如下。

| 原文 | 替换为 | 说明 |
| --- | --- | --- |
| {table} |

替换原则：优先选用课标内、语体相当的词；若某词在课标内没有对应项，则保留原词并在旁边给出简要注释，避免为了替换而牺牲准确性。

> 提示：机械替换只能保证词汇难度可控，替换后请通读一遍，确认搭配没有被破坏。
"""

_TITLE = "高三英语语篇深度分析讲稿"

# 图片识别的假转录：故意带上「学生答案 » 印刷原文」的对照痕迹，
# 让人一眼看出返回的是「只转录印刷内容」的那一版
_OCR_PRINTED = """## 第三部分 语言知识运用

### 第一节 完形填空

阅读下面的短文，从每题所给的四个选项中选出最佳选项。

I was walking home when I noticed an old man sitting on a bench. He looked
**41** and tired, so I stopped to ask if he needed help.

41. A. worried   B. excited   C. grateful   D. curious

### 第二节 语法填空

在空白处填入适当的内容（1 个单词）或括号内单词的正确形式。

Last summer I **56** (volunteer) at a local library, where I learned how to
organize books **57** patiently.

---

## 第四部分 写作

### 第一节 应用文写作

假定你是李华，你校将举办英语演讲比赛。请你写一则通知。

> 注意：词数 80 左右；可以适当增加细节，以使行文连贯。
"""

_OCR_HANDWRITTEN = """Last week our class held a discussion about whether students should do
volunteer work during the summer holiday.

Some students think it is a good chance to learn about [ILLEGIBLE] the real
world. They say we can also make new friends and improve our communication
skills.

Others believe we should spend the time on our study, especially before the
final exam.

In my opinion, doing volunteer work is helpful, but we should [OBSCURED] our
time well.
"""


def _echo(req: dict, input_text: str) -> str:
    """请求回执：把前端实际发来的字段写进正文，人工/agent 都能直接核对。"""
    payload = {
        "tool_id": req.get("tool_id"),
        "model": req.get("model"),
        "request_id": req.get("request_id"),
        "transfer_count": req.get("transfer_count"),
        "batch_id": req.get("batch_id"),
        "batch_size": req.get("batch_size"),
        "batch_index": req.get("batch_index"),
        "continue_from 长度": len(req.get("continue_from") or ""),
        "input 长度": len(input_text or ""),
        "input 前 120 字": (input_text or "")[:120],
    }
    return "## 假后端请求回执\n\n下面是本次请求前端实际发来的字段，用于核对请求参数是否符合预期。\n\n```json\n" \
        + json.dumps(payload, ensure_ascii=False, indent=2) \
        + "\n```\n\n> 这不是模型输出，只是假后端的回执。\n"


def build_content(name: str, plan: StreamPlan, req: dict, input_text: str, tool_id: str) -> str:
    """按内容名与工具产出正文。"""
    if name == "empty":
        return ""
    if name == "sentinel":
        return "@@CONTINUE_DONE@@\n"
    if name == "echo":
        return _echo(req, input_text)
    if name == "long":
        return _long()
    if name == "title":
        return _TITLE
    if name == "migration":
        # 用 replace 而不是 format：正文里的 KaTeX 花括号会被 format 当成占位符
        return _MIGRATION.replace("{cause}", req.get("_cause_label") or "细节定位失当")
    if name == "vocab":
        return _VOCAB.replace("{replaced}", "3").replace(
            "{table}",
            "| ubiquitous | common | 课标内有更基础的对应词 |\n"
            "| detrimental | harmful | 语体相当，难度更低 |\n"
            "| plethora | plenty of | 正式词降级为常用短语 |",
        )
    if name == "paper":
        return paper_mod.build_paper(plan, req, input_text)
    if name == "ocr":
        return _OCR_HANDWRITTEN if req.get("ocr_mode") == "handwritten" else _OCR_PRINTED
    return _GENERIC


def reasoning_text(plan: StreamPlan) -> str:
    """思考片段内容。"""
    if plan.reasoning_chars <= 0:
        return ""
    base = (
        "先读题干，划出唯一性最高的关键词；再带关键词回原文定位，只读前后各一句；"
        "然后把区间表述与四个选项逐一比对，重点看有没有程度失真与无中生有；"
        "最后确认答案在原文中有可验证的依据。"
    )
    if len(base) >= plan.reasoning_chars:
        return base[: plan.reasoning_chars]
    return (base * (plan.reasoning_chars // len(base) + 1))[: plan.reasoning_chars]
