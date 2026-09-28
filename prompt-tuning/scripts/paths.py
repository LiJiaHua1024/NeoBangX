"""路径解析：让所有工具脚本对"多个被调优 prompt"通用。

目录约定（prompt-tuning/ 为根）：
  config/           模型配置（真实配置忽略入库，*.example.json 入库）
  scripts/          全部工具脚本
  rubrics/          通用评审 rubric
  suites/<suite>/   某个被调优 prompt 的一切：cases.json、prompt/、notes.md、report.*
  runs/<suite>/     该 prompt 的原始产物（outputs/、work/），不入库

用法（在脚本里）：
  import paths
  paths.init(args.suite)          # 在 main() 开头解析 --suite
  paths.outputs_dir()             # runs/<suite>/outputs
  paths.work_dir()                # runs/<suite>/work
  paths.cases_file()              # suites/<suite>/cases.json
  paths.config_file("api_config.json")   # config/api_config.json
  paths.add_suite_arg(parser)     # 给 argparse 加 --suite
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"
SUITES_DIR = ROOT / "suites"
RUNS_DIR = ROOT / "runs"
RUBRICS_DIR = ROOT / "rubrics"

_suite: str | None = None


def available_suites() -> list[str]:
    if not SUITES_DIR.exists():
        return []
    return sorted(d.name for d in SUITES_DIR.iterdir()
                  if d.is_dir() and not d.name.startswith("_"))


def default_suite() -> str:
    env = os.environ.get("PROMPT_SUITE")
    if env:
        return env
    names = available_suites()
    if len(names) == 1:
        return names[0]
    if not names:
        raise SystemExit("suites/ 下没有任何 suite（先复制 suites/_template 建一个）")
    raise SystemExit(f"存在多个 suite，请用 --suite 指定：{', '.join(names)}")


def init(suite: str | None = None) -> str:
    """设置当前 suite（脚本 main() 开头调用一次）。"""
    global _suite
    _suite = suite or default_suite()
    if not (SUITES_DIR / _suite).exists():
        raise SystemExit(f"suite 不存在：{SUITES_DIR / _suite}")
    (RUNS_DIR / _suite).mkdir(parents=True, exist_ok=True)
    return _suite


def suite() -> str:
    return _suite or default_suite()


def suite_dir() -> Path:
    return SUITES_DIR / suite()


def run_dir() -> Path:
    return RUNS_DIR / suite()


def outputs_dir() -> Path:
    return run_dir() / "outputs"


def work_dir() -> Path:
    return run_dir() / "work"


def cases_file() -> Path:
    return suite_dir() / "cases.json"


def prompt_dir() -> Path:
    return suite_dir() / "prompt"


def config_file(name: str) -> Path:
    return CONFIG_DIR / name


def add_suite_arg(parser) -> None:
    parser.add_argument("--suite", default=None,
                        help=f"被调优的 prompt 名（默认 {os.environ.get('PROMPT_SUITE') or '唯一存在的 suite'}）")
