"""进程内可变状态：假使用码额度、请求日志、粘性场景、线路镜像配置。

单进程假设，与真实后端一样（限流/停止事件本来就是进程内协调）。
测试结束进程退出即全部清零，不需要落库。
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

MAX_REQUESTS = 300


@dataclass
class RequestRecord:
    """一条 /api/* 调用的记录。agent 靠它断言前端到底发了什么。"""

    ts: float
    method: str
    path: str
    authorization: bool
    fingerprint: str
    scenario: str
    body: dict | None = None
    # SSE 流专属：实际发出的帧统计，例如 "token×30 / reasoning×8 / done=[DONE]"
    summary: str = ""
    status: int = 200

    def as_dict(self) -> dict:
        return {
            "ts": round(self.ts, 3),
            "time": time.strftime("%H:%M:%S", time.localtime(self.ts)),
            "method": self.method,
            "path": self.path,
            "authorization": self.authorization,
            "fingerprint": self.fingerprint[:16] + ("…" if len(self.fingerprint) > 16 else ""),
            "scenario": self.scenario,
            "status": self.status,
            "summary": self.summary,
            "body": self.body,
        }


@dataclass
class MockState:
    # 额度：None = 无限；否则按次递减，用于测「剩余次数」与耗尽
    quota: int | None = None
    used: int = 0
    sticky: dict | None = None          # {"scenario":..., "params": {...}, "times": int|None}
    # 演示文稿（PPTX）总开关：对应管理后台的「开启演示文稿生成」。
    # 真实后端默认关；假后端默认开，让 PPT 链路开箱可测，测门禁时再 POST /__mock__/slides 关掉
    slides_enabled: bool = True
    # PPT 任务的默认场景名（"" = ppt-ok）。由 POST /__mock__/ppt 设置；
    # 不走粘性场景——PPT 创建紧随流式收尾发生，中间还夹着标题请求，粘性会被偷走
    ppt_scenario: str = ""
    mirror_enabled: bool = False
    mirror_origins: list[str] = field(default_factory=list)
    requests: deque = field(default_factory=lambda: deque(maxlen=MAX_REQUESTS))
    lock: threading.Lock = field(default_factory=threading.Lock)

    # ---- 请求日志 ----
    def record(self, **kwargs) -> RequestRecord:
        rec = RequestRecord(**kwargs)
        with self.lock:
            self.requests.append(rec)
        return rec

    def annotate(self, rec: RequestRecord, *, summary: str = "", status: int | None = None) -> None:
        with self.lock:
            if summary:
                rec.summary = summary
            if status is not None:
                rec.status = status

    def request_log(self) -> list[dict]:
        with self.lock:
            return [r.as_dict() for r in self.requests]

    def clear_requests(self) -> None:
        with self.lock:
            self.requests.clear()

    # ---- 粘性场景 ----
    def set_sticky(self, scenario: str, params: dict | None = None, times: int | None = None) -> None:
        with self.lock:
            self.sticky = {"scenario": scenario, "params": dict(params or {}), "times": times}

    def clear_sticky(self) -> None:
        with self.lock:
            self.sticky = None

    def take_sticky(self) -> dict | None:
        """取一次粘性场景；times 计数到 0 自动清除。None = 没有粘性场景。"""
        with self.lock:
            s = self.sticky
            if not s:
                return None
            times = s.get("times")
            if isinstance(times, int):
                if times <= 1:
                    self.sticky = None
                else:
                    s["times"] = times - 1
            return dict(s)

    # ---- 额度 ----
    def user_payload(self, code: str) -> dict:
        unlimited = self.quota is None
        remaining = -1 if unlimited else max(0, (self.quota or 0) - self.used)
        return {
            "code": code,
            "quota": -1 if unlimited else self.quota,
            "used_count": self.used,
            "remaining": remaining,
            "is_enabled": True,
            "is_exhausted": not unlimited and remaining <= 0,
            "is_unlimited": unlimited,
        }

    def consume(self, units: int = 1) -> None:
        if self.quota is None:
            return
        with self.lock:
            self.used += units

    def reset(self) -> None:
        with self.lock:
            self.used = 0
            self.sticky = None
            self.slides_enabled = True
            self.ppt_scenario = ""
            self.requests.clear()

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "quota": self.quota,
                "used": self.used,
                "sticky": dict(self.sticky) if self.sticky else None,
                "mirror_enabled": self.mirror_enabled,
                "mirror_origins": list(self.mirror_origins),
                "slides_enabled": self.slides_enabled,
                "ppt_scenario": self.ppt_scenario,
                "request_count": len(self.requests),
            }


STATE = MockState()
