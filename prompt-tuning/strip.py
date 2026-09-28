"""把生成结果砍掉「四、答案 + 解析」，产出供盲答/学生视角评审用的题目-only 版本。

用法：uv run python strip.py --round v0
输出到 outputs/{round}/blind/ 下同名文件。
"""
from __future__ import annotations

import argparse
from pathlib import Path

HERE = Path(__file__).parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True)
    args = ap.parse_args()
    out_dir = HERE / "outputs" / args.round
    blind_dir = out_dir / "blind"
    blind_dir.mkdir(exist_ok=True)
    for md_file in sorted(out_dir.glob("*.md")):
        md = md_file.read_text(encoding="utf-8")
        idx = md.find("## 四、答案 + 解析")
        if idx > 0:
            md = md[:idx].rstrip() + "\n"
        (blind_dir / md_file.name).write_text(md, encoding="utf-8")
        print(f"  {md_file.name} → blind/{md_file.name}")


if __name__ == "__main__":
    main()
