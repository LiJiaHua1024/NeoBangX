"""剥掉上游渠道在正文结尾追加的赞助 / 广告块。

背景
----
某些免费或低价 API 渠道会在每次回复的正文末尾追加一段广告，形如：

    ……正文……

    ---
    Sponsored by [Webz.io](https://platform.experientiallabs.ai/a/xxxx)
    Get Started. Scale your language learning content with Webz.io's ...

广告商与下方文案每次都会变，唯一稳定的是「一条独占一行的水平线 + 紧跟其后的
"Sponsored by" 段」。本模块据这个结构把整段尾巴切掉。

为什么按「内容特征」而不是「按渠道 / 按 Provider 开关」
--------------------------------------------------------
规则只认「水平线 + Sponsored by」这个组合，不接该渠道的部署永远匹配不到，
对它们就是一次空操作。因此既不需要数据库列、不需要后台开关，也不给 LLMRouter
传新配置——一个纯函数 + 一个有状态过滤器即可，改动面最小。

为什么还要一个流式版本
----------------------
正文是流式吐给前端的，而广告在「结尾」，事先不知道它有多长，不能等全部收完
再发。`EndSponsorFilter` 只在尾部出现「水平线候选」或「Sponsored by 前缀」时
才把这一小段扣住不发，其余正常文本逐 token 零延迟直通；一旦完整命中就进入
丢弃态，之后到流结束都不再吐。这样既能在广告上屏前拦住它，又不改变正常响应
的流式时序（现有测试断言「首个产出就是原文片段」不受影响）。
"""

from __future__ import annotations

import re

# 结尾赞助块：可选空行 + 独占一行的水平线（--- / *** / ___，三个及以上）
# + 紧跟的 Sponsored by 段。\Z 锚定结尾，保证只切「尾巴」，绝不误伤出现在
# 正文中间的同名结构（那种情况下后面还有正文，不该被吞掉）。
_END_SPONSOR_RE = re.compile(
    r"(?:^|\n)[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*\n"
    r"(?:[ \t]*\n)*"
    r"[ \t]*Sponsored\s+by\b.*\Z",
    re.IGNORECASE | re.DOTALL,
)

# 组成水平线的字符
_RULE_CHARS = frozenset("-*_")

# 用于判定「尾部是否正在输入 Sponsored by（的不完整前缀）」
_SPONSOR_PHRASE = "sponsored by"


def strip_end_sponsor(text: str) -> str:
    """非流式正文：命中结尾赞助块则截断到水平线之前，未命中原样返回。

    截断点落在水平线前的那个换行，因此结果可能带一个结尾换行——与流式版本
    `EndSponsorFilter` 的产出保持一致，两端不会因「切在哪」而出现差异。
    """
    if not text:
        return text
    match = _END_SPONSOR_RE.search(text)
    if match is None:
        return text
    return text[: match.start()]


def _ends_with_sponsor_prefix(buf: str) -> bool:
    """buf 尾部是否是 `sponsored by` 的一段**不完整**前缀（且从词首开始）。

    只看严格前缀（不含完整短语本身）——完整短语要么已被正则捕获，要么只是
    普通文本，都不需要再扣。要求前缀前是空白或串首，避免把任何以 "s" 结尾的
    普通单词（tokens、is……）误判成候选而白白延迟一个 token。
    """
    low = buf.lower()
    for n in range(len(_SPONSOR_PHRASE) - 1, 0, -1):
        if not low.endswith(_SPONSOR_PHRASE[:n]):
            continue
        pos = len(low) - n
        if pos == 0 or low[pos - 1].isspace():
            return True
        # 该前缀前不是词首 → 只是普通单词的一部分，继续看更短的前缀
    return False


def _tail_is_candidate(buf: str) -> bool:
    """buffer 尾部是否可能是赞助块的开头（据此决定要不要扣住这一小段）。

    只看最后一段非空内容：
    - 它只由水平线字符与空白组成 → 可能是水平线还没输完；
    - 整段都是空白 → 可能是水平线与 Sponsored by 之间的空行；
    - 尾部是 `sponsored by` 的不完整前缀 → 可能正在输入这一句。

    普通正文不含这三类形态，直接判否，得以零延迟直通。
    """
    if not buf:
        return False
    stripped = buf.rstrip(" \t\r\n")
    if not stripped:
        # 全是空白：可能是水平线前的空行 / 水平线与广告语之间的空行，先扣住
        return True
    line_start = stripped.rfind("\n") + 1
    tail = stripped[line_start:]
    if tail and all(ch in _RULE_CHARS or ch.isspace() for ch in tail):
        return True
    return _ends_with_sponsor_prefix(buf)


class EndSponsorFilter:
    """流式正文的结尾赞助块过滤器。

    用法：对每个上游数据块调用 `feed()`，把返回的字符串原样吐给下游；流正常
    结束后调用一次 `flush()`，把残留（可能是被扣住的普通结尾、也可能是一整段
    广告）收尾。未命中任何候选时 `feed()` 原样立刻返回，不做任何缓冲。
    """

    def __init__(self) -> None:
        self._buf = ""
        # 命中完整赞助块后置位：此后到流结束的内容一律丢弃，不再输出
        self._dropping = False

    def feed(self, chunk: str) -> str:
        """喂入一个数据块，返回本次可以安全输出的文本（可能为空串）。"""
        if self._dropping or not chunk:
            return ""
        self._buf += chunk

        match = _END_SPONSOR_RE.search(self._buf)
        if match is not None:
            out = self._buf[: match.start()]
            self._buf = ""
            self._dropping = True
            return out

        # 尾部仍可能是赞助块开头 → 扣住整段（此时 buffer 只会包含候选片段，很小）
        if _tail_is_candidate(self._buf):
            return ""

        out = self._buf
        self._buf = ""
        return out

    def flush(self) -> str:
        """流结束时收尾：未命中赞助块则返回残留文本，命中则返回空。"""
        if self._dropping:
            return ""
        out = strip_end_sponsor(self._buf)
        self._buf = ""
        return out
