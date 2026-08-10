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
from pathlib import Path

logger = logging.getLogger(__name__)

WORD_RE = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?。！？])\s+")

_WORDLIST_DIR = Path(__file__).resolve().parent.parent / "data"

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


# 常见头衔 / 缩写: 直接放行(Dr., Prof., St., No. 等)
_TITLES = {"dr", "prof", "st", "mt", "jr", "sr", "no"}

# 派生前缀: 词根在表即可放行(unhappy -> happy)
_PREFIXES = ("un", "dis", "im", "in", "ir", "il", "re")


def _inflection_candidates(word: str) -> list[str]:
    """对词形做保守的屈折回退,返回候选词形(不含原词)。"""
    candidates: list[str] = []

    if word.endswith("ies") and len(word) > 4:
        candidates.append(word[:-3] + "y")                       # cities -> city
    if word.endswith("es") and len(word) > 3:
        candidates.append(word[:-2])                            # watches -> watch
        candidates.append(word[:-1])                            # buses -> bus
    if word.endswith("s") and len(word) > 2 and not word.endswith("ss"):
        candidates.append(word[:-1])                            # books -> book, ads -> ad

    for suffix, strip in (("ing", 3), ("ed", 2)):
        if word.endswith(suffix) and len(word) > strip + 1:
            base = word[:-strip]
            candidates.append(base)
            candidates.append(base + "e")                       # making -> make, loved -> love, agreed -> agree
            if base[-2:] in _DOUBLE_LETTERS and base[-1] == base[-2]:
                candidates.append(base[:-1])                    # running -> run, stopped -> stop
            if base.endswith("ck"):
                candidates.append(base[:-1])                    # panicked -> panic
            if base.endswith("i"):
                candidates.append(base[:-1] + "y")              # dying -> dy -> di? 见下
            if base.endswith("y") and len(base) > 1:
                candidates.append(base[:-1] + "ie")             # dying -> die, lying -> lie
    if word.endswith("ier") and len(word) > 4:
        candidates.append(word[:-3] + "y")                      # happier -> happy
    if word.endswith("iest") and len(word) > 5:
        candidates.append(word[:-4] + "y")                      # happiest -> happy
    if word.endswith("er") and len(word) > 4:
        base = word[:-2]
        candidates.append(base)
        candidates.append(base + "e")                           # nicer -> nice, abler -> able
        if base[-2:] in _DOUBLE_LETTERS and base[-1] == base[-2]:
            candidates.append(base[:-1])                        # bigger -> big
    if word.endswith("est") and len(word) > 5:
        base = word[:-3]
        candidates.append(base)
        candidates.append(base + "e")                           # nicest -> nice, ablest -> able
        if base[-2:] in _DOUBLE_LETTERS and base[-1] == base[-2]:
            candidates.append(base[:-1])                        # biggest -> big

    # ---- 派生后缀回退(词根在表即放行, 副词/常见派生不算超标) ----
    if word.endswith("ly") and len(word) > 4:
        base = word[:-2]
        candidates.append(base)                                 # normally -> normal
        candidates.append(base + "e")                           # precisely -> precise
        if base.endswith("i"):
            candidates.append(base[:-1] + "y")                  # happily -> happy
        if base.endswith("al") and len(base) > 3:
            candidates.append(base[:-2])                        # basically -> basic
    if word.endswith("or") and len(word) > 4:
        candidates.append(word[:-2])                            # visitor -> visit
    if word.endswith("al") and len(word) > 4:
        candidates.append(word[:-2])                            # formal -> form
        candidates.append(word[:-2] + "e")                      # natural -> nature
    if word.endswith("en") and len(word) > 4:
        candidates.append(word[:-2])                            # shorten -> short
    if word.endswith("tion") and len(word) > 6:
        candidates.append(word[:-4] + "te")                     # communication -> communicate
        candidates.append(word[:-4])                            # action -> act
    if word.endswith("sion") and len(word) > 5:
        candidates.append(word[:-4] + "de")                     # conclusion -> conclude
        candidates.append(word[:-4])                            # expression -> express
    if word.endswith("ison") and len(word) > 5:
        candidates.append(word[:-4] + "e")                      # comparison -> compare
    if word.endswith("ness") and len(word) > 5:
        candidates.append(word[:-4])                            # darkness -> dark
        candidates.append(word[:-4] + "y")                      # happiness -> happy
    if word.endswith("ful") and len(word) > 5:
        candidates.append(word[:-3])                            # careful -> care
        candidates.append(word[:-3] + "y")                      # beautiful -> beauty
    if word.endswith("ive") and len(word) > 5:
        candidates.append(word[:-3])                            # active -> act
        candidates.append(word[:-3] + "e")                      # creative -> create
    if word.endswith("ous") and len(word) > 5:
        candidates.append(word[:-3])                            # famous -> fam
        candidates.append(word[:-3] + "e")                      # famous -> fame
    if word.endswith("ity") and len(word) > 5:
        candidates.append(word[:-3])                            # ability -> abil
        candidates.append(word[:-3] + "y")                      # ability -> abily
    if word.endswith("ment") and len(word) > 6:
        candidates.append(word[:-4])                            # development -> develop
    if word.endswith("able") and len(word) > 6:
        candidates.append(word[:-4])                            # reasonable -> reason
    if word.endswith("ible") and len(word) > 6:
        candidates.append(word[:-4])                            # terrible -> terr
    if word.endswith("ist") and len(word) > 4:
        candidates.append(word[:-3])                            # artist -> art
        candidates.append(word[:-3] + "ce")                     # scientist -> science
    return candidates


class VocabChecker:
    """词表常驻内存的机械超标词排查器。"""

    def __init__(self, wordlist_dir: Path = _WORDLIST_DIR):
        self._words: set[str] = set()
        self._meta: dict[str, dict] = {}
        self._load(wordlist_dir)

    def _load(self, wordlist_dir: Path) -> None:
        words_file = wordlist_dir / "gaokao3500_words.json"
        meta_file = wordlist_dir / "gaokao3500.json"
        if words_file.exists():
            raw = json.loads(words_file.read_text(encoding="utf-8"))
            self._words = {w.lower() for w in raw}
            logger.info("Loaded %d syllabus words from %s", len(self._words), words_file)
        else:
            logger.warning("Syllabus wordlist not found: %s", words_file)

        if meta_file.exists():
            raw = json.loads(meta_file.read_text(encoding="utf-8"))
            for entry in raw:
                for key in entry.get("word_keys", []):
                    kl = key.lower()
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
                raw = token
                w = token.lower()
                # 去掉撇号变形: don't -> don, it's -> it, teachers' -> teachers
                if "'" in w or "’" in w:
                    w = w.split("'")[0].split("’")[0]
                if not w.isalpha():
                    continue
                # 单字母大写视为选项标记/缩写(B. C. D. 等), 不参与排查
                if len(w) == 1 and raw[0].isupper():
                    continue
                # 全大写视为缩写(USA、CEO 等), 不参与排查
                if raw.isupper() and len(raw) > 1:
                    continue
                # 常见头衔/缩写直接放行
                if w in _TITLES:
                    continue
                total += 1
                if self._in_syllabus(w):
                    continue
                contexts = seen.setdefault(w, [])
                if len(contexts) < 3:
                    contexts.append(sentence[:220])
                total_seen[w] = total_seen.get(w, 0) + 1
                if raw and raw[0].isupper():
                    cap_seen[w] = cap_seen.get(w, 0) + 1

        over_words = [
            {
                "word": w,
                "count": len(ctxs),
                # 仅当该词全部出现均为首字母大写时才标记为可能专有名词
                "maybe_proper": cap_seen.get(w, 0) == total_seen.get(w, 0),
                "sentences": ctxs,
                **self.metadata(w),
            }
            for w, ctxs in seen.items()
        ]
        over_words.sort(key=lambda item: (-item["count"], item["word"]))
        return {"total_words": total, "over_words": over_words}

    def _in_syllabus(self, word: str) -> bool:
        """多层回退: 屈折/派生可叠加(reviewers -> review, unexpectedly -> expect)。
        候选只减不增, 递归必然终止, 深度上限 + 失败缓存兜底。"""
        return self._lookup_recursive(word, 0, set())

    def _lookup_recursive(self, word: str, depth: int, memo: set[str]) -> bool:
        if depth > 3 or word in memo:
            return False
        if word in self._words:
            return True
        memo.add(word)
        base = _IRREGULAR.get(word)
        if base is not None and self._lookup_recursive(base, depth + 1, memo):
            return True
        for candidate in _inflection_candidates(word):
            if self._lookup_recursive(candidate, depth + 1, memo):
                return True
        for prefix in _PREFIXES:
            if word.startswith(prefix) and len(word) > len(prefix) + 2:
                if self._lookup_recursive(word[len(prefix):], depth + 1, memo):
                    return True
        return False

    def metadata(self, word: str) -> dict:
        """返回词表中该词(或其屈折原形)的词性与释义,用于表格回填。"""
        w = word.lower()
        entry = self._meta.get(w)
        if entry is not None:
            return entry
        base = _IRREGULAR.get(w)
        if base is not None:
            return self._meta.get(base, {"pos": "", "meaning": ""})
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
