"""异步收尾：等待已有任务完成，记录并延后传播调用者的重复取消。"""

import asyncio
from typing import TypeVar

T = TypeVar("T")


async def await_cleanup(task: asyncio.Task[T]) -> tuple[T, bool]:
    """用于连接关闭、结算等必须完成的短收尾，不屏蔽普通生成请求的取消。"""
    cancelled = False
    while True:
        try:
            await asyncio.shield(task)
            break
        except asyncio.CancelledError:
            cancelled = True
            if task.done():
                break
    return task.result(), cancelled
