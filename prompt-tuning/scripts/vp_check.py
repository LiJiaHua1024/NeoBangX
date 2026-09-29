# -*- coding: utf-8 -*-
"""试卷可视化全解：机械检查（秒级、免费、不受评审偏好影响）。

三类检查：
A 协议合规  @@TAG@@ 格式/取值位置/顺序/题数/题型/语篇引用/迁移块数/题号
B 照录保真  STEM 与 OPTIONS 必须能在材料中逐字找到；EVIDENCE 必须是所属语篇的连续原文
C 迁移质量  迁移语篇词数、迁移题型同型、换皮（与原语篇最长公共子串）、答案字母分布、长度线索

用法：
  uv run python vp_check.py --round v0
  uv run python vp_check.py --round v0 --suite 试卷可视化全解
结果：work/vp_check_<round>.json
"""
from __future__ import annotations

import paths
import argparse
import json
import re
from pathlib import Path

import vp_parse as vp

ALLOWED_GROUP_IDS = {"reading", "cloze7", "cloze", "grammar", "writing_app", "writing_cont", "other"}
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")
ABS_RE = re.compile(r"\b(all|never|only|must|no one|none|always|completely)\b", re.I)


def words(text: str) -> int:
    return len(WORD_RE.findall(text or ""))


def latin_runs(text: str) -> str:
    """取一段里最长的拉丁文连续片段（用于在 EVIDENCE 的中文叙述里挑出原文引用）。"""
    best = ""
    for m in re.finditer(r"[A-Za-z][A-Za-z0-9'’\- ,.;:()\"\u201c\u201d/]*", text or ""):
        if len(m.group()) > len(best):
            best = m.group()
    return best.strip(" ,.;:—-")


def opt_letters(text: str) -> list[tuple[str, str]]:
    """从选项正文里切出 (字母, 内容)；兼容 A. xx B. xx 同行与分行。"""
    if not text:
        return []
    out = []
    pat = re.compile(r"(?:^|[\s\u3000])([A-G])\s*[.、．]\s*")
    ms = list(pat.finditer(text))
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        out.append((m.group(1), text[m.end():end].strip()))
    return out


def check_file(md: str, case: dict, count: int) -> dict:
    d = vp.parse(md)
    r: dict = {"issues": [f"[{i['kind']}] L{i['line']} {i['detail']}" for i in d["issues"]],
               "n_q": len(d["questions"]), "total": d["total"],
               "q_nums": [q["num"] for q in d["questions"]],
               "qtypes": [q["qtype"] for q in d["questions"]],
               "n_passage_def": len(d["passage_def_order"]),
               "passage_ids": sorted(d["passages"].keys()),
               "transfer_blocks": [len(q["transfers"]) for q in d["questions"]]}
    material = case.get("material", "")
    mnorm = vp.norm(material)

    # ---------- A 协议合规 ----------
    if d["has_code_fence"]:
        r["issues"].append("[code_fence] 输出里出现 Markdown 代码围栏（禁止）")
    if d["total"] != len(d["questions"]):
        r["issues"].append(f"[total_mismatch] TOTAL={d['total']} 但 Q 块数={len(d['questions'])}")

    exp_total = case.get("expect_total")
    r["total_ok"] = (d["total"] == exp_total)
    if exp_total is not None and d["total"] != exp_total:
        r["issues"].append(f"[total_wrong] 期望 TOTAL={exp_total}，实际 {d['total']}")

    q_start = case.get("q_start")
    if q_start is not None and d["questions"]:
        expect_nums = list(range(q_start, q_start + len(d["questions"])))
        r["nums_ok"] = [q["num"] for q in d["questions"]] == expect_nums
        if not r["nums_ok"]:
            r["issues"].append(f"[q_num_shift] 题号应为 {expect_nums[0]}…{expect_nums[-1]}，"
                               f"实际 {[q['num'] for q in d['questions']]}")

    # 分组 id
    for g in d["groups"]:
        if g["id"] not in ALLOWED_GROUP_IDS:
            r["issues"].append(f"[group_id] 非法分组 id “{g['id']}”")
        if g["n_parts"] != 3:
            r["issues"].append(f"[group_fmt] 分组不是 id|title|intro 三段：{g['n_parts']} 段")

    # 题型 / 选项 / 引用 / 迁移块
    blank_with_options, choice_no_options, ref_bad, transfer_bad, seq_bad, writing_bad = [], [], [], [], [], []
    for q in d["questions"]:
        n = q["num"]
        opts = q["fields"].get("OPTIONS", [""])[0]
        qt = q["qtype"]
        if qt not in ("choice", "blank", "writing"):
            r["issues"].append(f"[qtype_bad] Q{n} QTYPE=“{qt}”（只能 choice/blank/writing）")
        if qt == "blank" and opt_letters(opts):
            blank_with_options.append(n)
        if qt == "choice" and not opt_letters(opts):
            choice_no_options.append(n)
        if qt == "writing":
            if q["passage_ref"] != "-" or q["transfers"]:
                writing_bad.append(n)
        else:
            if q["passage_ref"] not in d["passages"]:
                ref_bad.append(n)
            if len(q["transfers"]) != count:
                transfer_bad.append((n, len(q["transfers"])))
        probs = vp.tag_sequence_check(q)
        if probs:
            seq_bad.append((n, probs))
    if blank_with_options:
        r["issues"].append(f"[fake_options] 非选择题被编造选项：Q{blank_with_options}")
    if choice_no_options:
        r["issues"].append(f"[missing_options] 选择题 OPTIONS 缺失：Q{choice_no_options}")
    if ref_bad:
        r["issues"].append(f"[ref_dangling] PASSAGE_REF 指向不存在的语篇：Q{ref_bad}")
    if transfer_bad:
        r["issues"].append(f"[transfer_count] 迁移块数≠{count}：{transfer_bad}")
    if writing_bad:
        r["issues"].append(f"[writing_branch] 写作题不该有迁移/应 PASSAGE_REF='-'：Q{writing_bad}")
    for n, probs in seq_bad:
        r["issues"].append(f"[tag_seq] Q{n}: {'；'.join(probs)}")
    # 声明了但没被引用
    used = {q["passage_ref"] for q in d["questions"] if q["passage_ref"] != "-"}
    unused = [p for p in d["passages"] if p not in used]
    if unused:
        r["issues"].append(f"[passage_unused] 声明的语篇无人引用：{unused}")

    # ---------- B 照录保真 ----------
    stem_miss, opt_miss, ev_miss = [], [], []
    for q in d["questions"]:
        n = q["num"]
        stem = (q["fields"].get("STEM") or [""])[0]
        if stem and vp.norm(stem) not in mnorm:
            lcs = vp.longest_common_substr(vp.norm(stem), mnorm)
            stem_miss.append((n, round(lcs / max(len(vp.norm(stem)), 1), 2)))
        for letter, txt in opt_letters((q["fields"].get("OPTIONS") or [""])[0]):
            if txt and vp.norm(txt) not in mnorm:
                opt_miss.append((n, letter, round(vp.longest_common_substr(vp.norm(txt), mnorm)
                                                  / max(len(vp.norm(txt)), 1), 2)))
        ev = (q["fields"].get("EVIDENCE") or [""])[0]
        run = latin_runs(ev)
        pid = q["passage_ref"]
        src = vp.norm(d["passages"].get(pid, "") + " " + stem)
        if run and vp.norm(run) not in src:
            ev_miss.append((n, round(vp.longest_common_substr(vp.norm(run), src)
                                     / max(len(vp.norm(run)), 1), 2), run[:60]))
    r["stem_verbatim_miss"] = stem_miss
    r["options_verbatim_miss"] = opt_miss
    r["evidence_not_found"] = ev_miss
    if stem_miss:
        r["issues"].append(f"[stem_not_verbatim] 题干未逐字照录：{stem_miss}")
    if opt_miss:
        r["issues"].append(f"[option_not_verbatim] 选项未逐字照录：{opt_miss}")
    if ev_miss:
        r["issues"].append(f"[evidence_not_found] EVIDENCE 不是语篇连续原文：{ev_miss}")

    # ---------- B2 答案是否与材料所附答案一致 ----------
    ki = material.rfind("参考答案")
    key = {}
    if ki >= 0:
        for m in re.finditer(r"(\d{1,3})\s*[.、．]\s*([A-G])(?![\w])", material[ki:]):
            key[int(m.group(1))] = m.group(2)
    mism = []
    for q in d["questions"]:
        if q["qtype"] == "choice" and q["num"] in key:
            got = ((q["fields"].get("ANSWER") or [""])[0]).strip().upper()
            got_l = got[:1] if got else ""
            if got_l != key[q["num"]]:
                mism.append((q["num"], f"输出“{got or '空'}”", f"材料“{key[q['num']]}”"))
    r["answer_key_mismatch"] = mism
    r["key_size"] = len(key)
    if mism:
        r["issues"].append(f"[answer_wrong] 参考答案与材料所附答案不一致：{mism}")

    # ---------- C 迁移质量 ----------
    src_words, trans_words, dedupe = [], [], []
    ans_letters, longest_correct, extreme_correct = [], [], []
    t_passages = []
    for q in d["questions"]:
        pid = q["passage_ref"]
        src = d["passages"].get(pid, "")
        stem = (q["fields"].get("STEM") or [""])[0]
        n_opt_src = len(opt_letters((q["fields"].get("OPTIONS") or [""])[0]))
        for bi, t in enumerate(q["transfers"], 1):
            tp = t.get("TRANSFER_PASSAGE", "")
            w = words(tp)
            trans_words.append((q["num"], bi, w))
            if w and not (80 <= w <= 120):
                r["issues"].append(f"[transfer_len] Q{q['num']} 迁移{bi} 语篇 {w} 词（要求 80-120）")
            if tp:
                t_passages.append(((q["num"], bi), tp))
                lcs = vp.longest_common_substr(vp.norm(tp), vp.norm(src + " " + stem))
                ratio = round(lcs / max(len(vp.norm(tp)), 1), 2)
                trans_words[-1] = (q["num"], bi, w)
                if ratio >= 0.25 or lcs >= 40:
                    r["issues"].append(f"[transfer_copy] Q{q['num']} 迁移{bi} 与原语篇最长公共子串 "
                                       f"{lcs} 字（换皮/复述风险）")
            topts = opt_letters(t.get("TRANSFER_OPTIONS", ""))
            tans = (t.get("TRANSFER_ANSWER") or "").strip()
            tq_type = q["qtype"]
            if tq_type == "choice":
                n_t = len(topts)
                if n_opt_src and n_t != n_opt_src:
                    r["issues"].append(f"[transfer_pool_mismatch] Q{q['num']} 原题 {n_opt_src} 选项，"
                                       f"迁移 {n_t} 选项（选项池形式应与原题一致）")
                if n_t not in (4, 7) and n_opt_src in (0, 4):
                    r["issues"].append(f"[transfer_type] Q{q['num']} 迁移{bi} 选项 {n_t} 个（应为 4 个）")
                if tans:
                    # 支持多空共享池：答案形如 "1. D 2. F 3. B"，按出现顺序取全部字母
                    ls = [x.upper() for x in re.findall(r"(?<![\w])([A-G])(?![\w])", tans)]
                    if len(ls) == 1:
                        L = ls[0]
                        ans_letters.append(L)
                        lens = [len(x[1]) for x in topts]
                        if topts and lens:
                            mx = max(lens)
                            idx = [i for i, x in enumerate(topts) if x[0] == L]
                            if idx and lens[idx[0]] == mx and lens.count(mx) == 1:
                                longest_correct.append((q["num"], bi))
                                if mx >= 1.5 * (sum(lens) / len(lens)):
                                    extreme_correct.append((q["num"], bi))
                        cor_txt = [x[1] for x in topts if x[0] == L]
                        if cor_txt and ABS_RE.search(cor_txt[0]):
                            extreme_correct.append((q["num"], bi, "绝对化词在正确项"))
                    elif ls:
                        ans_letters.extend(ls)
            elif tq_type == "blank":
                if topts:
                    r["issues"].append(f"[transfer_type] Q{q['num']} 迁移{bi} 是填空题却给了选项")
                if not tans:
                    r["issues"].append(f"[transfer_type] Q{q['num']} 迁移{bi} 缺 TRANSFER_ANSWER")
                # 语法填空的迁移只该挖一个空：多空会把别的语法点一起考进来
                n_blank = len(re.findall(r"_{2,}|\d{1,2}\s*\(", t.get("TRANSFER_PASSAGE", "")))
                if n_blank > 1:
                    r["issues"].append(f"[transfer_blank_multi] Q{q['num']} 迁移{bi} 是 blank 类型却挖了 "
                                       f"{n_blank} 个空（应只挖一个空，每空一题）")
    # 迁移之间的自我重复
    for i in range(len(t_passages)):
        for j in range(i + 1, len(t_passages)):
            (na, ia), ta = t_passages[i]
            (nb, ib), tb = t_passages[j]
            if na == nb:
                continue
            lcs = vp.longest_common_substr(vp.norm(ta), vp.norm(tb))
            if lcs >= 30:
                dedupe.append((f"{na}.{ia}-{nb}.{ib}", lcs))
    r["transfer_words"] = trans_words
    r["transfer_ans_letters"] = ans_letters
    if ans_letters:
        from collections import Counter
        c = Counter(ans_letters)
        top, k = c.most_common(1)[0]
        r["ans_letter_top"] = f"{top}:{k}/{len(ans_letters)}"
        if k / len(ans_letters) > 0.6 and len(ans_letters) >= 4:
            r["issues"].append(f"[ans_position] 迁移答案字母集中：{dict(c)}")
        if len(c) == 1 and len(ans_letters) >= 3:
            r["issues"].append(f"[ans_position] 迁移答案全部为 {top}（可被机械利用）")
    if longest_correct:
        r["longest_correct_rate"] = round(len(longest_correct) / max(len(ans_letters), 1), 2)
        if r["longest_correct_rate"] > 0.5 and len(ans_letters) >= 4:
            r["issues"].append(f"[length_cue] 正确项是最长项的比例 {r['longest_correct_rate']:.0%}"
                               f"（≥50% 时可被猜）")
    if extreme_correct:
        r["issues"].append(f"[shape_cue] 正确项靠长度/绝对化措辞显眼：{extreme_correct}")
    r["transfer_pair_dup"] = dedupe
    if dedupe:
        r["issues"].append(f"[transfer_dup] 迁移题之间高度相似：{dedupe}")

    # ---------- C2 范式泄题：范式正文不得含迁移题的答案线索 ----------
    leaks = []
    for q in d["questions"]:
        pat = (q["fields"].get("PATTERN_STEPS") or [""])[0] + " " + \
              (q["fields"].get("PATTERN_NAME") or [""])[0]
        pn = vp.norm(pat)
        for bi, t in enumerate(q["transfers"], 1):
            tgt = vp.norm(t.get("TRANSFER_PASSAGE", "") + " " + t.get("TRANSFER_STEM", "") + " " +
                          t.get("TRANSFER_OPTIONS", ""))
            lcs = vp.longest_common_substr(pn, tgt)
            if lcs >= 20:
                # 找出重叠片段，便于人工判读
                leaks.append((q["num"], bi, lcs))
    r["pattern_leak"] = leaks
    if leaks:
        r["issues"].append(f"[pattern_leak] 范式与迁移题正文重叠 ≥20 字（疑似泄题）：{leaks}")

    # ---------- D 四维完整性 ----------
    for q in d["questions"]:
        n = q["num"]
        if q["qtype"] == "writing":
            for k in vp.WRITING_SEQ:
                if not (q["writing"].get(k) or "").strip():
                    r["issues"].append(f"[writing_missing] Q{n} 写作三件套缺 {k}")
            continue
        pit = (q["fields"].get("PITFALLS") or [""])[0]
        lines = [x for x in pit.splitlines() if x.strip()]
        if not (2 <= len(lines) <= 3):
            r["issues"].append(f"[pitfalls_count] Q{n} 易错点 {len(lines)} 条（要求 2-3）")
        steps = (q["fields"].get("PATTERN_STEPS") or [""])[0]
        sl = [x for x in steps.splitlines() if x.strip()]
        if not steps.strip():
            r["issues"].append(f"[pattern_missing] Q{n} 缺 PATTERN_STEPS")
        elif not (2 <= len(sl) <= 3):
            r["issues"].append(f"[pattern_steps] Q{n} 范式步骤 {len(sl)} 行（要求 2-3）")
        for k in ("ANSWER", "EVIDENCE", "REASON", "DISTRACTOR", "PATTERN_NAME"):
            if not (q["fields"].get(k) or [""])[0].strip():
                r["issues"].append(f"[field_missing] Q{n} 缺 {k}")
    return r


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    paths.add_suite_arg(ap)
    args = ap.parse_args()
    paths.init(args.suite)
    cases = json.loads(paths.cases_file().read_text(encoding="utf-8"))
    out_dir = paths.outputs_dir() / args.round
    report = {}
    for f in sorted(out_dir.glob("*.md")):
        case_id = f.stem.rsplit("_q", 1)[0]
        count = int(f.stem.rsplit("_q", 1)[1])
        if case_id not in cases:
            continue
        report[f.stem] = check_file(f.read_text(encoding="utf-8"), cases[case_id], count)
    paths.work_dir().mkdir(parents=True, exist_ok=True)
    (paths.work_dir() / f"vp_check_{args.round}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    kinds: dict[str, int] = {}
    print(f"{'文件':<26}{'TOTAL':<7}{'题块':<6}{'语篇':<5}{'块数':<14}{'问题数'}")
    for k, r in report.items():
        for it in r["issues"]:
            tag = it.split("]")[0].strip("[")
            kinds[tag] = kinds.get(tag, 0) + 1
        print(f"{k:<26}{str(r['total']):<7}{r['n_q']:<6}{r['n_passage_def']:<5}"
              f"{str(r['transfer_blocks']):<14}{len(r['issues'])}")
    print(f"\n== 问题类型分布（{args.round}）==")
    for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"  {k:<22}{v}")
    print(f"\n完整报告：work/vp_check_{args.round}.json")


if __name__ == "__main__":
    main()
