"""流式正文里两类「约定标记」的过滤器：结尾赞助块、续写完成标记。

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

续写完成标记（`ContinueDoneFilter`）
------------------------------------
`prompts/继续生成.md` 约定：残文其实已经写完时，模型只回一行
``@@CONTINUE_DONE@@``。用户手点「继续生成」时前端会把这行剥掉；但路由层在
中途断流后**自动**续写时前端并不知道这是一次续写，所以必须由后端吃掉它，
否则会拼进成品文档。识别刻意放宽（`@`/`＠` 数量、大小写、空格/下划线/连字符、
代码围栏与括号包裹），与前端 `CONTINUE_DONE_SRC` 同义。
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

    def handover(self) -> "EndSponsorFilter":
        """中途断流续写时的交接：把还没输出的尾部候选带到下一条流。

        断点可能正好落在赞助块候选中间（如 ``"\\n--\\nSpons"``）。这一段属于
        已经生成的正文，但过滤器还不敢吐：若续写的开头把它补成完整的赞助块，
        应当整段丢掉；若补成普通正文，应当原样吐出。丢掉缓冲会让「Spons」和
        续写的「ored by …」各自成段，反而把广告漏到用户眼前。

        已经进入丢弃态（整段赞助块命中，说明正文已自然收尾）时交接一个空过滤器：
        之后的内容是续写新写的正文，不该被上一条流的丢弃态吞掉。
        """
        nxt = EndSponsorFilter()
        if not self._dropping:
            nxt._buf = self._buf
        self._buf = ""
        return nxt


# ---- 续写完成标记 ----

# 标记本体允许前后带分隔符 / 代码围栏 / 括号：模型对定界符的写法会漂移，
# 实测 `@@CONTINUE_DONE@@`、`**CONTINUE-DONE**`、```\n@@continue_done@@\n```
# 都出现过，严格匹配必漏。与前端 CONTINUE_DONE_SRC 的口径保持一致。
_CONTINUE_DONE_WRAP = "`*~_@＠\\s\\[\\]【】()（）<>《》\"'"
_CONTINUE_DONE_RE = re.compile(
    rf"[{_CONTINUE_DONE_WRAP}]*CONTINUE[\s_\-]*DONE[{_CONTINUE_DONE_WRAP}]*",
    re.IGNORECASE,
)
# 为了判断「尾部是否可能是标记前缀」，允许出现在候选里的字符（其余字符一出现
# 就说明这是普通正文，立刻放行）。字母数字另由 isalnum() 覆盖。
_MARKER_PUNCT = frozenset("`*~_@＠-[]【】()（）<>《》\"' \t\r\n")
_MARKER_WORD = "CONTINUEDONE"
# 候选最多扣住多少个字符：正常标记远小于它，超长的一律当正文放行。
_MAX_SENTINEL_HOLD = 64


def _sentinel_tail_len(buf: str) -> int:
    """buf 尾部「可能是完成标记前缀」的长度；0 表示不像标记，可以整段放行。"""
    n = len(buf)
    if not n:
        return 0
    for start in range(max(0, n - _MAX_SENTINEL_HOLD), n):
        suffix = buf[start:]
        if any(ch not in _MARKER_PUNCT and not ch.isalnum() for ch in suffix):
            continue
        core = "".join(ch for ch in suffix.upper() if ch.isalnum())
        if core:
            if len(core) > len(_MARKER_WORD) or not _MARKER_WORD.startswith(core):
                continue
        return n - start
    return 0


class ContinueDoneFilter:
    """续写流里的「其实已经写完」标记过滤器。

    只在自动续写的尝试里用。普通续写正文逐 token 零延迟直通：只有尾部看起来
    像标记前缀时才扣住（最多 `_MAX_SENTINEL_HOLD` 字符，下一次 feed 就放行）。
    命中完整标记后 `hit` 置位，调用方据此判断「残文已完整、这次续写没有内容」；
    标记之后只剩围栏 / 空白这类格式残留时继续扣着，见到真正文才放行。
    """

    def __init__(self) -> None:
        self._buf = ""
        self._released = False
        self.hit = False

    @staticmethod
    def _is_noise(text: str) -> bool:
        """整段是否只是围栏 / 括号 / 空白（标记后面的格式残留）。"""
        return bool(text) and all(ch in _MARKER_PUNCT for ch in text)

    def feed(self, chunk: str) -> str:
        """喂入一个数据块，返回本次可以安全输出的文本（可能为空串）。"""
        if self._released:
            return chunk
        self._buf += chunk or ""
        head = ""
        if not self.hit:
            match = _CONTINUE_DONE_RE.search(self._buf)
            if match is None:
                # 只扣住「可能是标记前缀」的尾巴：普通正文（尤其中文）零延迟直通，
                # 标记写在正文后面（模型偶尔会先说一句「已完整」）也能照样剥掉
                tail = _sentinel_tail_len(self._buf)
                if tail:
                    out = self._buf[:-tail]
                    self._buf = self._buf[-tail:]
                else:
                    out = self._buf
                    self._buf = ""
                return out
            # 标记本体吃掉，它前面的正文照常吐出；后面的围栏/换行留给下面判定
            self.hit = True
            head = self._buf[: match.start()]
            self._buf = self._buf[match.end():]
        if not self._buf:
            return head
        if self._is_noise(self._buf):
            if len(self._buf) > _MAX_SENTINEL_HOLD:
                # 异常长的「格式残留」：不再扣，原样放行（宁可多几个符号也不吞正文）
                out = head + self._buf
                self._buf = ""
                self._released = True
                return out
            return head
        # 标记之后出现了真正的正文：模型违反了「只回标记」的约定，内容照常吐出
        out = head + self._buf
        self._buf = ""
        self._released = True
        return out

    def flush(self) -> str:
        """流结束时收尾：整段就是标记（或它的截断前缀）则吞掉，否则吐出残留正文。"""
        buf, self._buf = self._buf, ""
        self._released = True
        if self.hit:
            return "" if self._is_noise(buf) else buf
        if not buf:
            return ""
        if _CONTINUE_DONE_RE.fullmatch(buf.strip()):
            self.hit = True
            return ""
        if self._is_noise(buf):
            return ""
        # 整段都可能是标记的不完整前缀（如断在 "@@CONTINU"）：当已完整处理，
        # 别把半截标记泄漏进正文。至少要认出 6 个标记字符才算数——否则续写只吐出
        # 一个 "C" / "CO" 这类正常短正文也会被当成标记吞掉。
        core = "".join(ch for ch in buf.upper() if ch.isalnum())
        if len(core) >= 6 and _MARKER_WORD.startswith(core) and _sentinel_tail_len(buf) == len(buf):
            self.hit = True
            return ""
        return _CONTINUE_DONE_RE.sub("", buf)
