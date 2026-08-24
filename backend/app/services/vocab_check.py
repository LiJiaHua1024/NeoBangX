"""超标词机械排查服务。

基于高考课标词汇表(backend/app/data/gaokao3500_words.json)做集合匹配:
- 输入英语文本,正则分词,逐词查表
- 屈折回退(复数/时态/比较级/所有格/不规则动词)
- 常见派生回退(副词 -ly、名词化 -tion/-ness/-ment、形容词化 -al/-ive/-ful、
  -er/-or 施动者、-en 动词化、un-/dis-/re- 等前缀),多层可叠加,
  词根在表即放行——副词和常见派生词不算超标
- 全部为 set 查询,千词文本毫秒级返回

词表在首次调用时加载为模块级单例,常驻内存。
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

WORD_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?。！？])\s+")

# 部分课标词条(hi/I/oh/ad 等)的 word_keys 为空, 需从 word 字段回退提取核心词形
_CORE_WORD_RE = re.compile(r"[A-Za-z]+")


def _core_word(entry_word: str) -> str:
    """从课标词条的 word 字段提取核心词形(小写)。

    处理 "can1 (could)" -> can、"dream (dreamt...)" -> dream、
    "ad (缩) =advertisement" -> ad、"I" -> i 等带括号/数字/符号的情况。
    """
    w = _CORE_WORD_RE.search(entry_word)
    return w.group(0).lower() if w else ""

_WORDLIST_DIR = Path(__file__).resolve().parent.parent / "data"

# 课标补充词集: 词表文件缺失但属高考课标范围的高频基础词
# (according/community/economic/source 等均高频出现在高考真题中, 词表漏收)
# 优先补原子词根, 派生形式由预展开规则覆盖; 规则覆盖不到的派生词一并补入
_EXTRA_WORDS = {
    # 词根补充(其屈折/派生形式可被预展开覆盖)
    "accord", "commune", "economy", "efficiency", "intellect", "involve", "maintain",
    "recognize", "source", "essence", "item", "option", "region", "current", "overall",
    "series", "enable", "ensure", "efficient", "economic", "essential", "social",
    # 派生规则覆盖不到的课标词, 直接补入
    "community", "intelligent", "intellectual", "responsible", "response",
    "significant", "simply", "neighborhood", "ease", "modernization",
    # 报告高频出现、属高考课标范围的常用词(词表漏收)
    "cannot", "email", "confidence", "behavior", "individual", "financial",
    "consumption", "recognition", "contact", "impact", "ceremony", "landscape",
    "imagination", "passion", "curiosity", "journal", "issue", "infer", "transition",
    "campus", "threat", "recovery", "probable", "hiking", "dining", "okay", "shown",
    "details", "devices", "employees", "participants", "ingredients", "located",
    "motivated", "historical", "humor", "genius", "polar", "gossip", "fully",
    "workshop", "workout", "code", "individuals",
}

# 常见不规则动词/名词复数等,回退到词表词形
_IRREGULAR: dict[str, str] = {
    # be / have / do
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be",
    "been": "be", "being": "be",
    "has": "have", "had": "have", "having": "have",
    "does": "do", "did": "do", "done": "do", "doing": "do",
    # 不规则过去式 / 过去分词
    "went": "go", "gone": "go", "going": "go",
    "took": "take", "taken": "take", "taking": "take",
    "bought": "buy", "boughten": "buy", "buying": "buy",
    "thought": "think", "thinking": "think",
    "wrote": "write", "written": "write", "writing": "write",
    "spoke": "speak", "spoken": "speak", "speaking": "speak",
    "broke": "break", "broken": "break", "breaking": "break",
    "drove": "drive", "driven": "drive", "driving": "drive",
    "rode": "ride", "ridden": "ride", "riding": "ride",
    "ate": "eat", "eaten": "eat", "eating": "eat",
    "fell": "fall", "fallen": "fall", "falling": "fall",
    "felt": "feel", "feeling": "feel",
    "kept": "keep", "keeping": "keep",
    "left": "leave", "leaving": "leave",
    "lost": "lose", "losing": "lose",
    "made": "make", "making": "make",
    "met": "meet", "meeting": "meet",
    "paid": "pay", "paying": "pay",
    "said": "say", "saying": "say",
    "sold": "sell", "selling": "sell",
    "sent": "send", "sending": "send",
    "sat": "sit", "sitting": "sit",
    "stood": "stand", "standing": "stand",
    "taught": "teach", "teaching": "teach",
    "told": "tell", "telling": "tell",
    "won": "win", "winning": "win",
    "became": "become", "become": "become", "becoming": "become",
    "came": "come", "come": "come", "coming": "come",
    "gave": "give", "given": "give", "giving": "give",
    "got": "get", "gotten": "get", "getting": "get",
    "grew": "grow", "grown": "grow", "growing": "grow",
    "knew": "know", "known": "know", "knowing": "know",
    "ran": "run", "running": "run", "run": "run",
    "saw": "see", "seen": "see", "seeing": "see",
    "sang": "sing", "sung": "sing", "singing": "sing",
    "swam": "swim", "swum": "swim", "swimming": "swim",
    "threw": "throw", "thrown": "throw", "throwing": "throw",
    "flew": "fly", "flown": "fly", "flying": "fly",
    "drew": "draw", "drawn": "draw", "drawing": "draw",
    "wore": "wear", "worn": "wear", "wearing": "wear",
    "chose": "choose", "chosen": "choose", "choosing": "choose",
    "began": "begin", "begun": "begin", "beginning": "begin",
    "drank": "drink", "drunk": "drink", "drinking": "drink",
    "rang": "ring", "rung": "ring", "ringing": "ring",
    "sank": "sink", "sunk": "sink", "sinking": "sink",
    "swore": "swear", "sworn": "swear", "swearing": "swear",
    "woke": "wake", "woken": "wake", "waking": "wake",
    "shook": "shake", "shaken": "shake", "shaking": "shake",
    "hid": "hide", "hidden": "hide", "hiding": "hide",
    "held": "hold", "holding": "hold",
    "lent": "lend", "lending": "lend",
    "spent": "spend", "spending": "spend",
    "built": "build", "building": "build",
    "fed": "feed", "feeding": "feed",
    "found": "find", "finding": "find",
    "heard": "hear", "hearing": "hear",
    "laid": "lay", "laying": "lay",
    "led": "lead", "leading": "lead",
    "lay": "lie", "lain": "lie", "lying": "lie",
    "meant": "mean", "meaning": "mean",
    "put": "put", "putting": "put",
    "read": "read", "reading": "read",
    "set": "set", "setting": "set",
    "shut": "shut", "shutting": "shut",
    "cut": "cut", "cutting": "cut",
    "hit": "hit", "hitting": "hit",
    "hurt": "hurt", "hurting": "hurt",
    "let": "let", "letting": "let",
    "bet": "bet", "betting": "bet",
    "cost": "cost", "costing": "cost",
    # 更多不规则过去式 / 过去分词
    "learnt": "learn", "learned": "learn", "learning": "learn",
    "dreamt": "dream", "dreamed": "dream", "dreaming": "dream",
    "burnt": "burn", "burned": "burn", "burning": "burn",
    "lit": "light", "lighted": "light", "lighting": "light",
    "hung": "hang", "hanging": "hang",
    "sought": "seek", "seeking": "seek",
    "brought": "bring", "bringing": "bring",
    "fought": "fight", "fighting": "fight",
    "caught": "catch", "catching": "catch",
    "shone": "shine", "shining": "shine",
    "froze": "freeze", "frozen": "freeze", "freezing": "freeze",
    "stole": "steal", "stolen": "steal", "stealing": "steal",
    "rose": "rise", "risen": "rise", "rising": "rise",
    "arose": "arise", "arisen": "arise", "arising": "arise",
    "tore": "tear", "torn": "tear", "tearing": "tear",
    "bore": "bear", "borne": "bear", "bearing": "bear",
    "bit": "bite", "bitten": "bite", "biting": "bite",
    "forgot": "forget", "forgotten": "forget", "forgetting": "forget",
    "forgave": "forgive", "forgiven": "forgive", "forgiving": "forgive",
    "mistook": "mistake", "mistaken": "mistake", "mistaking": "mistake",
    "undertook": "undertake", "undertaken": "undertake", "undertaking": "undertake",
    "withdrew": "withdraw", "withdrawn": "withdraw", "withdrawing": "withdraw",
    "fled": "flee", "fleeing": "flee",
    "blew": "blow", "blown": "blow", "blowing": "blow",
    "sprang": "spring", "sprung": "spring", "springing": "spring",
    "swung": "swing", "swinging": "swing",
    "slept": "sleep", "sleeping": "sleep",
    "swept": "sweep", "sweeping": "sweep",
    "wept": "weep", "weeping": "weep",
    "spelt": "spell", "spelled": "spell", "spelling": "spell",
    "knelt": "kneel", "kneeled": "kneel", "kneeling": "kneel",
    "crept": "creep", "creeping": "creep",
    "leapt": "leap", "leaped": "leap", "leaping": "leap",
    "stuck": "stick", "sticking": "stick",
    "dug": "dig", "digging": "dig",
    "slid": "slide", "sliding": "slide",
    "sped": "speed", "speeded": "speed", "speeding": "speed",
    "smelt": "smell", "smelled": "smell", "smelling": "smell",
    "spilt": "spill", "spilled": "spill", "spilling": "spill",
    # 常见否定缩写回退 (don't -> don -> do, didn't -> didn -> do)
    "don": "do", "doesn": "do", "didn": "do",
    "isn": "be", "aren": "be", "wasn": "be", "weren": "be",
    "hasn": "have", "haven": "have", "hadn": "have",
    "won": "will", "wouldn": "will", "shan": "shall", "shouldn": "shall",
    "couldn": "can", "mustn": "must", "needn": "need", "daren": "dare",
    # 不规则复数
    "children": "child", "people": "person", "men": "man",
    "women": "woman", "mice": "mouse", "feet": "foot",
    "teeth": "tooth", "geese": "goose", "oxen": "ox",
    # 比较级 / 最高级
    "better": "good", "best": "good",
    "worse": "bad", "worst": "bad",
    "more": "much", "most": "much",
    "less": "little", "least": "little",
    "further": "far", "furthest": "far", "farther": "far", "farthest": "far",
}

# 按长度排序,先长后短,保证 s 时先试 es/ies
_SUFFIX_RULES = [
    ("ies", lambda w: w[:-3] + "y"),           # cities -> city
    ("es", lambda w: w[:-2]),                  # watches -> watch, buses -> bus
    ("ed", lambda w: w[:-2]),                  # worked -> work
    ("ed", lambda w: w[:-1]),                  # loved -> lov... 走 below
    ("ing", lambda w: w[:-3]),                 # working -> work
    ("s", lambda w: w[:-1]),                   # books -> book
    ("er", lambda w: w[:-2]),                  # smaller -> small
    ("est", lambda w: w[:-3]),                 # smallest -> small
]

_DOUBLE_LETTERS = {
    "bb", "cc", "dd", "ff", "gg", "ll", "mm", "nn", "pp", "rr", "ss", "tt", "zz",
}


# 常见头衔 / 缩写: 直接放行(Dr., Prof., St., No., a.m., p.m. 等)
# th/nd/rd 为序数词(5th/20th/2nd/3rd)分词后的残片, 非真实单词, 一并放行
_TITLES = {"dr", "prof", "st", "mt", "jr", "sr", "no", "am", "pm", "ad", "bc", "etc", "vs", "ok", "th", "nd", "rd"}

# 派生前缀: 词根在表即可放行(unhappy -> happy)
_PREFIXES = ("un", "dis", "im", "in", "ir", "il", "re")

# 回退后缀提示: 词尾不匹配任何已知后缀时, 直接判定超纲(快速失败)
_SUFFIX_HINT = (
    "ies", "es", "s", "ing", "ed", "ier", "iest", "er", "est",
    "ly", "or", "al", "en", "tion", "sion", "ison", "ness", "ful",
    "ive", "ous", "ity", "ment", "able", "ible", "ist",
)


def _inflection_candidates(word: str) -> list[str]:
    """对词形做保守的屈折回退,返回候选词形(不含原词)。"""
    if not word.endswith(_SUFFIX_HINT):
        return []
    candidates: list[str] = []
    wlen = len(word)

    # 复数 / 三单
    if word.endswith(("ies", "es", "s")):
        if word.endswith("ies") and wlen > 4:
            candidates.append(word[:-3] + "y")                   # cities -> city
        if word.endswith("es") and wlen > 3:
            candidates.append(word[:-2])                        # watches -> watch
            candidates.append(word[:-1])                        # buses -> bus
        if word.endswith("s") and wlen > 2 and not word.endswith("ss"):
            candidates.append(word[:-1])                        # books -> book, ads -> ad

    # 进行时 / 过去式
    if word.endswith(("ing", "ed")):
        strip = 3 if word.endswith("ing") else 2
        if wlen > strip + 1:
            base = word[:-strip]
            candidates.append(base)
            candidates.append(base + "e")                       # making -> make, loved -> love, agreed -> agree
            if base[-2:] in _DOUBLE_LETTERS and base[-1] == base[-2]:
                candidates.append(base[:-1])                    # running -> run, stopped -> stop
            if base.endswith("ck"):
                candidates.append(base[:-1])                    # panicked -> panic
            if base.endswith("i"):
                candidates.append(base[:-1] + "y")              # skiing -> ski 的误候选, 无害
            if base.endswith("y") and len(base) > 1:
                candidates.append(base[:-1] + "ie")             # dying -> die, lying -> lie

    # 比较级 / 最高级
    if word.endswith(("ier", "iest", "er", "est")):
        if word.endswith("ier") and wlen > 4:
            candidates.append(word[:-3] + "y")                  # happier -> happy
        if word.endswith("iest") and wlen > 5:
            candidates.append(word[:-4] + "y")                  # happiest -> happy
        if word.endswith("er") and wlen > 4:
            base = word[:-2]
            candidates.append(base)
            candidates.append(base + "e")                       # nicer -> nice, abler -> able
            if base[-2:] in _DOUBLE_LETTERS and base[-1] == base[-2]:
                candidates.append(base[:-1])                    # bigger -> big
        if word.endswith("est") and wlen > 5:
            base = word[:-3]
            candidates.append(base)
            candidates.append(base + "e")                       # nicest -> nice, ablest -> able
            if base[-2:] in _DOUBLE_LETTERS and base[-1] == base[-2]:
                candidates.append(base[:-1])                    # biggest -> big

    # 派生后缀
    if word.endswith(
        ("ly", "or", "al", "en", "tion", "sion", "ison", "ness",
         "ful", "ive", "ous", "ity", "ment", "able", "ible", "ist")
    ):
        if word.endswith("ly") and wlen > 4:
            base = word[:-2]
            candidates.append(base)                             # normally -> normal
            candidates.append(base + "e")                       # precisely -> precise
            if base.endswith("i"):
                candidates.append(base[:-1] + "y")              # happily -> happy
            if base.endswith("al") and len(base) > 3:
                candidates.append(base[:-2])                    # basically -> basic
        if word.endswith("or") and wlen > 4:
            candidates.append(word[:-2])                        # visitor -> visit
        if word.endswith("al") and wlen > 4:
            candidates.append(word[:-2])                        # formal -> form
            candidates.append(word[:-2] + "e")                  # natural -> nature
        if word.endswith("en") and wlen > 4:
            candidates.append(word[:-2])                        # shorten -> short
        if word.endswith("tion") and wlen > 6:
            candidates.append(word[:-4] + "te")                 # communication -> communicate
            candidates.append(word[:-4])                        # action -> act
        if word.endswith("sion") and wlen > 5:
            candidates.append(word[:-4] + "de")                 # conclusion -> conclude
            candidates.append(word[:-4])                        # expression -> express
        if word.endswith("ison") and wlen > 5:
            candidates.append(word[:-4] + "e")                  # comparison -> compare
        if word.endswith("ness") and wlen > 5:
            candidates.append(word[:-4])                        # darkness -> dark
            candidates.append(word[:-4] + "y")                  # happiness -> happy
        if word.endswith("ful") and wlen > 5:
            candidates.append(word[:-3])                        # careful -> care
            candidates.append(word[:-3] + "y")                  # beautiful -> beauty
        if word.endswith("ive") and wlen > 5:
            candidates.append(word[:-3])                        # active -> act
            candidates.append(word[:-3] + "e")                  # creative -> create
        if word.endswith("ous") and wlen > 5:
            candidates.append(word[:-3])                        # famous -> fam
            candidates.append(word[:-3] + "e")                  # famous -> fame
        if word.endswith("ity") and wlen > 5:
            candidates.append(word[:-3])                        # ability -> abil
            candidates.append(word[:-3] + "y")                  # ability -> abily
        if word.endswith("ment") and wlen > 6:
            candidates.append(word[:-4])                        # development -> develop
        if word.endswith("able") and wlen > 6:
            candidates.append(word[:-4])                        # reasonable -> reason
        if word.endswith("ible") and wlen > 6:
            candidates.append(word[:-4])                        # terrible -> terr
        if word.endswith("ist") and wlen > 4:
            candidates.append(word[:-3])                        # artist -> art
            candidates.append(word[:-3] + "ce")                 # scientist -> science
    return candidates


_VOWELS = set("aeiou")


def _expanded_forms(word: str, pos: str = "") -> set[str]:
    """生成课标词 w 的屈折/派生形式(用于预展开查表)。

    与 _inflection_candidates 互为逆方向。为避免把 as+s=ass、he+al=heal
    这类"小功能词拼后缀碰巧构成真实词"的形式误放行:
    - 屈折(复数/时态/比较)仅对 >=3 字母的 名词/动词/形容词 生成
    - 派生后缀与前缀仅对 >=4 字母的词生成
    """
    forms = {word}
    n = pos.startswith("n.")
    v = pos.startswith(("v.", "vt.", "vi.")) or pos in ("v", "vt", "vi")
    a = pos.startswith("adj.")

    # --- 屈折: 名词复数/三单, 动词时态, 形容词比较级 ---
    if len(word) >= 3:
        if n or v:
            forms.add(word + "s")
            if word.endswith(("s", "x", "z", "ch", "sh")):
                forms.add(word + "es")
            if word.endswith("y") and len(word) > 1 and word[-2] not in _VOWELS:
                forms.add(word[:-1] + "ies")
        if v:
            forms.add(word + "ed")
            if word.endswith("e"):
                forms.add(word + "d")
            if word.endswith("y") and len(word) > 1 and word[-2] not in _VOWELS:
                forms.add(word[:-1] + "ied")
            forms.add(word + "ing")
            if word.endswith("e"):
                forms.add(word[:-1] + "ing")
            if word.endswith("ie"):
                forms.add(word[:-2] + "ying")
            if len(word) >= 3 and word[-1] in "bcdfglmnprstz" and word[-2] in _VOWELS:
                forms.add(word + word[-1] + "ed")
                forms.add(word + word[-1] + "ing")
        if a:
            forms.add(word + "er")
            forms.add(word + "est")
            if word.endswith("e"):
                forms.add(word + "r")
                forms.add(word + "st")
            if word.endswith("y") and len(word) > 1 and word[-2] not in _VOWELS:
                forms.add(word[:-1] + "ier")
                forms.add(word[:-1] + "iest")
            if len(word) >= 3 and word[-1] in "bcdfglmnprstz" and word[-2] in _VOWELS:
                forms.add(word + word[-1] + "er")
                forms.add(word + word[-1] + "est")

    # --- 派生后缀 / 前缀: 仅实义词且 >=4 字母 ---
    if len(word) >= 4 and (n or v or a):
        forms.add(word + "ly")
        if word.endswith("y") and word[-2] not in _VOWELS:
            forms.add(word[:-1] + "ily")                            # happy -> happily
        forms.add(word + "ness")
        if word.endswith("y") and word[-2] not in _VOWELS:
            forms.add(word[:-1] + "iness")                          # happy -> happiness
        forms.add(word + "ment")
        forms.add(word + "ful")
        if word.endswith("y") and word[-2] not in _VOWELS:
            forms.add(word[:-1] + "iful")                           # beauty -> beautiful
        forms.add(word + "less")
        forms.add(word + "ive")
        forms.add(word + "al")
        forms.add(word + "ous")
        if word.endswith("e"):
            forms.add(word[:-1] + "ous")                            # fame -> famous
        forms.add(word + "tion")
        if word.endswith("e"):
            forms.add(word[:-1] + "tion")                           # relate -> relation
        forms.add(word + "sion")
        forms.add(word + "able")
        forms.add(word + "ible")
        forms.add(word + "ist")
        forms.add(word + "or")
        forms.add(word + "er")
        forms.add(word + "en")
        forms.add(word + "ity")
        if word.endswith("e"):
            forms.add(word[:-1] + "ity")                            # able -> ability
        if word.endswith("y") and word[-2] not in _VOWELS:
            forms.add(word[:-1] + "ity")                            # rapid -> rapidity
        for prefix in ("un", "dis", "im", "in", "ir", "il", "re"):
            forms.add(prefix + word)
    return forms


class VocabChecker:
    """词表常驻内存的机械超标词排查器。"""

    def __init__(self, wordlist_dir: Path = _WORDLIST_DIR):
        self._words: set[str] = set()
        self._meta: dict[str, dict] = {}
        self._load(wordlist_dir)
        self._build_expanded()

    def _build_expanded(self) -> None:
        """预展开词表: 课标词的屈折/派生形式预先算好进集合, 运行时纯 O(1) 查表。

        展开集合包含词表词本身、其一步屈折/派生形式、不规则映射的所有词形,
        与运行时递归回退等价(递归同样会放行这些形式), 但免去逐词递归开销。
        """
        expanded = set(self._words)
        for w in self._words:
            if re.fullmatch(r"[a-z]{2,}", w):
                pos = self._meta.get(w, {}).get("pos", "")
                expanded |= _expanded_forms(w, pos)
        # 仅保留 base 在词表的不规则映射, 避免 bet/kneel 等词根本身超纲的形式被误放行
        for form, base in _IRREGULAR.items():
            if base in self._words:
                expanded.add(form)
        self._lookup = expanded
        logger.info("Expanded lookup set to %d entries", len(self._lookup))

    def _load(self, wordlist_dir: Path) -> None:
        words_file = wordlist_dir / "gaokao3500_words.json"
        meta_file = wordlist_dir / "gaokao3500.json"
        if words_file.exists():
            raw = json.loads(words_file.read_text(encoding="utf-8"))
            self._words = {w.lower() for w in raw}
            self._words.update(_EXTRA_WORDS)
            self._words.add("i")
            self._words.add("whoever")
            logger.info("Loaded %d syllabus words from %s", len(self._words), words_file)
        else:
            logger.warning("Syllabus wordlist not found: %s", words_file)

        if meta_file.exists():
            raw = json.loads(meta_file.read_text(encoding="utf-8"))
            for entry in raw:
                keys = [k.lower() for k in entry.get("word_keys", [])]
                # 部分课标词条(hi/I/oh/ad 等) word_keys 为空, 从 word 字段回退提取核心词
                if not keys:
                    core = _core_word(entry.get("word", ""))
                    if core:
                        keys = [core]
                        self._words.add(core)
                for kl in keys:
                    if kl not in self._meta:
                        self._meta[kl] = {
                            "pos": entry.get("pos", ""),
                            "meaning": entry.get("meaning", ""),
                        }
        logger.info("Loaded %d word metadata entries", len(self._meta))

    def check(self, text: str) -> dict:
        """排查文本,返回 {total_words, over_words: [...]}。"""
        sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(text or "") if s.strip()]

        seen: dict[str, list] = {}
        cap_seen: dict[str, int] = {}
        total_seen: dict[str, int] = {}
        total = 0
        for sentence in sentences:
            for token in WORD_RE.findall(sentence):
                total += self._process_token(token, sentence, seen, cap_seen, total_seen)

        over_words = [
            {
                "word": w,
                "count": total_seen.get(w, len(ctxs)),
                # 仅当该词全部出现均为首字母大写时才标记为可能专有名词
                "maybe_proper": cap_seen.get(w, 0) == total_seen.get(w, 0),
                "sentences": ctxs,
                **self.metadata(w),
            }
            for w, ctxs in seen.items()
        ]
        over_words.sort(key=lambda item: (-item["count"], item["word"]))
        return {"total_words": total, "over_words": over_words}

    def _process_token(
        self,
        raw: str,
        sentence: str,
        seen: dict[str, list],
        cap_seen: dict[str, int],
        total_seen: dict[str, int],
    ) -> int:
        """处理单个词元，返回其计入 total_words 的数量（0 或 1；连字符词为段数）。"""
        w = raw.lower()
        # 快速路径: 词表(含预展开形式, 含 e-mail 等自带连字符的词条)直接放行
        if w in self._lookup:
            return 1
        # 连字符复合词: 词表精确匹配未命中时拆段逐一排查计数
        # (cyber-bullying -> cyber / bullying), 避免整词逃过排查
        if "-" in w:
            count = 0
            for part in w.split("-"):
                if part:
                    count += self._process_token(part, sentence, seen, cap_seen, total_seen)
            return count
        # 慢路径: 特殊形态处理
        # 去掉撇号变形: don't -> don, it's -> it, teachers' -> teachers
        if "'" in w or "’" in w:
            w = w.split("'")[0].split("’")[0]
        if not w.isalpha():
            return 0
        # 单字母仅 a 与 I 为合法单词，其余(选项标记/缩写/撇号残留等)不参与排查
        if len(w) == 1 and w not in ("a", "i"):
            return 0
        # 全大写视为缩写(USA、CEO 等), 不参与排查
        if raw.isupper() and len(raw) > 1:
            return 0
        # 常见头衔/缩写直接放行
        if w in _TITLES:
            return 0
        if self._in_syllabus(w):
            return 1
        contexts = seen.setdefault(w, [])
        if len(contexts) < 3:
            contexts.append(sentence[:220])
        total_seen[w] = total_seen.get(w, 0) + 1
        if raw and raw[0].isupper():
            cap_seen[w] = cap_seen.get(w, 0) + 1
        return 1

    @lru_cache(maxsize=262144)
    def _in_syllabus(self, word: str) -> bool:
        """多层回退: 屈折/派生可叠加(reviewers -> review, unexpectedly -> expect)。

        先查预展开集合(纯 O(1)); 未命中时走快速失败路径——
        不规则映射 / 单层候选 / 单层前缀, 大多数超纲词止步于此,
        只有真正需要多层叠加的词才进入递归。顶层结果带 LRU 缓存。"""
        if word in self._lookup:
            return True
        base = _IRREGULAR.get(word)
        if base is not None:
            return self._lookup_recursive(base, 1, set())
        if word.endswith(_SUFFIX_HINT):
            for candidate in _inflection_candidates(word):
                if candidate in self._lookup:
                    return True
        if word.startswith(_PREFIXES):
            for prefix in _PREFIXES:
                if word.startswith(prefix) and len(word) > len(prefix) + 2:
                    stripped = word[len(prefix):]
                    if stripped in self._lookup:
                        return True
                    if _IRREGULAR.get(stripped) is not None:
                        if self._lookup_recursive(_IRREGULAR[stripped], 1, set()):
                            return True
                    for candidate in _inflection_candidates(stripped):
                        if candidate in self._lookup:
                            return True
        return self._lookup_recursive(word, 0, set())
    def _lookup_recursive(self, word: str, depth: int, memo: set[str]) -> bool:
        if depth > 3 or word in memo:
            return False
        if word in self._lookup:
            return True
        memo.add(word)
        base = _IRREGULAR.get(word)
        if base is not None and self._lookup_recursive(base, depth + 1, memo):
            return True
        for candidate in _inflection_candidates(word):
            if self._lookup_recursive(candidate, depth + 1, memo):
                return True
        if word.startswith(_PREFIXES):
            for prefix in _PREFIXES:
                if word.startswith(prefix) and len(word) > len(prefix) + 2:
                    if self._lookup_recursive(word[len(prefix):], depth + 1, memo):
                        return True
        return False

    @lru_cache(maxsize=65536)
    def metadata(self, word: str) -> dict:
        """返回词表中该词(或其屈折/派生原形)的词性与释义,用于表格回填。"""
        w = word.lower()
        entry = self._meta.get(w)
        if entry is not None:
            return entry
        base = _IRREGULAR.get(w)
        if base is not None:
            return self._meta.get(base, {"pos": "", "meaning": ""})
        if w.endswith(_SUFFIX_HINT):
            for c in _inflection_candidates(w):
                if c in self._meta:
                    return self._meta[c]
        return {"pos": "", "meaning": ""}


_checker: VocabChecker | None = None


def get_checker() -> VocabChecker:
    global _checker
    if _checker is None:
        _checker = VocabChecker()
    return _checker


def check_over_words(text: str) -> dict:
    """便捷入口,供路由调用。"""
    return get_checker().check(text)
