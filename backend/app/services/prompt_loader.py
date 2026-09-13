import os
import re
from pathlib import Path
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)

# 模板占位符：{{user_input}}、{{transfer_count}} 等
_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")
# 未显式传值的占位符回落值：Prompt 里写了 {{x}} 但调用方没给时也不会把占位符漏给模型
DEFAULT_VARIABLES = {
    "user_input": "",
    "transfer_count": "1",
}


class PromptLoader:
    """Prompt 文件加载器

    负责从 prompts/ 目录加载所有工具的 Prompt 文件，并提供运行时读取。
    """

    def __init__(self, prompts_dir: Path):
        self.prompts_dir = Path(prompts_dir)
        self._cache: Dict[str, str] = {}
        self._load_all()

    def _load_all(self) -> None:
        """加载 prompts/ 目录下所有 .md 文件"""
        if not self.prompts_dir.exists():
            logger.warning(f"Prompts directory not found: {self.prompts_dir}")
            return

        for file_path in self.prompts_dir.glob("*.md"):
            tool_name = file_path.stem
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                self._cache[tool_name] = content
                logger.info(f"Loaded prompt: {tool_name}")
            except Exception as e:
                logger.error(f"Failed to load prompt {tool_name}: {e}")

    def get(self, tool_name: str) -> Optional[str]:
        """根据工具名（即文件名，不含扩展名）获取 Prompt 内容"""
        return self._cache.get(tool_name)

    def list_tools(self) -> Dict[str, str]:
        """返回所有已加载的 Prompt 文件名 -> 内容摘要"""
        return {name: content[:200] for name, content in self._cache.items()}

    def reload(self) -> None:
        """重新加载所有 Prompt 文件"""
        self._cache.clear()
        self._load_all()

    def render(
        self,
        tool_name: str,
        user_input: str,
        variables: Optional[Dict[str, object]] = None,
    ) -> Optional[str]:
        """将用户输入与工具参数注入到 Prompt 模板中

        模板变量写作 {{name}}：{{user_input}} 为材料正文，其余为工具参数
        （如 {{transfer_count}}）。整份模板只做一遍替换，用户输入里若含
        {{...}} 字面量不会被二次扫描。未传值的占位符按 DEFAULT_VARIABLES
        回落，避免把裸占位符送给模型。
        """
        template = self.get(tool_name)
        if template is None:
            return None
        values: Dict[str, str] = dict(DEFAULT_VARIABLES)
        values["user_input"] = user_input
        for key, value in (variables or {}).items():
            if value is None:
                continue
            values[str(key)] = str(value)
        return _PLACEHOLDER_RE.sub(
            lambda m: values.get(m.group(1), m.group(0)), template
        )
