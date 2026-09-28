"""从 work/ab/*.json 汇总 A/B 盲评结果。"""
import json
import sys
from pathlib import Path

round_a, round_b = sys.argv[1], sys.argv[2]
tag = sys.argv[3] if len(sys.argv) > 3 else f"{round_a}-vs-{round_b}"
files = sorted(Path("work/ab").glob(f"{tag}/*.json"))
tally = {d: {"A": 0, "B": 0, "tie": 0} for d in ("transfer", "deception", "answers", "overall")}
n = 0
for f in files:
    r = json.loads(f.read_text(encoding="utf-8"))
    v = r.get("verdict") or {}
    n += 1
    for d in tally:
        key = v.get(d, "tie")
        tally[d][key if key in tally[d] else "tie"] += 1
print(f"A={round_a}, B={round_b}，完成配对 {n}")
for d, c in tally.items():
    print(f"  {d:<11}: A {c['A']} - tie {c['tie']} - B {c['B']}")
wins = sum(1 for f in files if (json.loads(f.read_text(encoding='utf-8')).get('verdict') or {}).get('overall') == 'A')
wins_b = sum(1 for f in files if (json.loads(f.read_text(encoding='utf-8')).get('verdict') or {}).get('overall') == 'B')
ties = n - wins - wins_b
print(f"\noverall 胜负：{round_a} {wins} 胜 / {round_b} {wins_b} 胜 / 平 {ties}")
for f in files:
    r = json.loads(f.read_text(encoding='utf-8'))
    v = r.get('verdict') or {}
    print(f"  {r['case']} q{r['count']:02d}: overall={v.get('overall')} | {str(v.get('reason'))[:80]}")
