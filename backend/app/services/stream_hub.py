"""可续接的生成流：把「生成」与「某一条 HTTP 连接」解耦。

为什么要有这一层
----------------
生成一条长内容（长文、整卷、翻译）要几十秒到几分钟，而这期间网络最容易出问题：
地铁进隧道、手机切 Wi-Fi、笔记本合盖、代理按空闲超时掐连接。原来的实现里，生成
就长在 HTTP 响应里——连接一断，服务端下一次往流里写时发现客户端没了，就地把生成
收掉（半篇内容写成一条 cancelled 日志），客户端只能看到「生成中断」再手点「继续
生成」。两次请求之间模型要重新起笔，续写的接缝、重复段落、推理过程丢失都从这里来。

这一层做的事只有一件：**生成跑到一个带序号的事件缓冲里，HTTP 连接只是这个缓冲的
一个读者**。读者掉了，生成继续；读者回来时按 `Last-Event-ID` 语义从缺口接着发，
不重复、不丢字。一段时间没人接（用户真的走了）才停，避免白烧上游 token。

协议
----
- 每个事件带 `id: <seq>`（SSE 标准字段），客户端原样回传 `since=<seq>` 即可续接。
- 空闲时每个 tick 间隔发一条 `event: tick`：客户端据此区分「模型在想」与「连接死了」，
  也顺带挡住反代按空闲超时切流。
- 会话结束后缓冲再留 ttl 秒：客户端在最后一段丢包后醒来，仍能补齐尾部与终止帧。
  过期后返回 404，客户端退回「已生成的部分保留 + 继续生成」这条老路。

并发与进程边界
--------------
全部状态在进程内存里，和既有的 `/api/chat/stop`（`_stop_events`）同一前提：
**多 worker 部署时续接请求必须落回同一个 worker**（本项目默认单 uvicorn 进程，
见 supervisord.conf）。多 worker 部署需要把会话表换成共享存储，此处不假装支持。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from dataclasses import dataclass
from time import monotonic
from typing import AsyncGenerator, AsyncIterator, Optional

from app.config import settings
from app.services.async_cleanup import await_cleanup

logger = logging.getLogger(__name__)

# 单条流的事件缓冲上限。正常输出的正文 + 推理远小于这个量级（max_tokens 撑死
# 十万级字符）；超过只可能是异常情况。撞上限后**已经在读的**客户端不受影响，
# 但新来的续接一律拒绝（它拿不到完整缺口，宁可让它走手动续写也别给半截）。
MAX_BUFFER_BYTES = 4 * 1024 * 1024

# 无人接续、又迟迟不退出时，再等这么久就硬取消生成任务（正常路径由 stop_event
# 让上游自己收尾并结算；这里兜住「上游卡在等首块、根本不看 stop_event」的情况，
# 别让一个僵尸任务永久占住上游连接）
ABANDON_FORCE_CANCEL_SECONDS = 10

_sessions: dict[str, "StreamSession"] = {}


class ResumeUnavailable(RuntimeError):
    """这条流无法从缺口续接（已过期 / 缓冲溢出 / 序号越界）。"""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(slots=True)
class _BufferedEvent:
    seq: int
    event: str
    data: str


def _ms_setting(name: str, default: int) -> float:
    try:
        value = int(getattr(settings, name, default))
    except (TypeError, ValueError):
        value = default
    return max(0, value) / 1000.0


class StreamSession:
    """一次生成的缓冲与会话生命周期。构造后由路由 `bind_source` 绑定生成器。"""

    def __init__(
        self,
        session_id: str,
        owner_code: Optional[str],
        owner_identity: str,
        stop_event: asyncio.Event,
        *,
        grace: Optional[float] = None,
        ttl: Optional[float] = None,
        tick_interval: Optional[float] = None,
        max_buffer_bytes: int = MAX_BUFFER_BYTES,
    ):
        self.id = session_id
        # 归属：有码的流只认同一把码（含已用尽但令牌仍有效的码），匿名流只认指纹/IP。
        # 两者分开存，是因为续接请求再来时使用码可能刚好被这次生成用光了。
        self.owner_code = owner_code
        self.owner_identity = owner_identity
        self.stop_event = stop_event
        self.created = monotonic()
        self._events: deque[_BufferedEvent] = deque()
        self._last_seq = 0
        self._bytes = 0
        self._resumable = True
        self._done = False
        self._finished_at: Optional[float] = None
        self._finished_event = asyncio.Event()
        self._subscribers = 0
        self._attaches = 0
        self._detached_at: Optional[float] = None
        self._waiters: set[asyncio.Event] = set()
        self._watchdog: Optional[asyncio.Task] = None
        self._evict_handle: Optional[asyncio.TimerHandle] = None
        self._agen: Optional[AsyncGenerator] = None
        self._pump_task: Optional[asyncio.Task] = None
        self._started = False
        self._grace = (
            float(grace) if grace is not None else max(0.0, float(settings.sse_resume_grace))
        )
        self._ttl = float(ttl) if ttl is not None else max(0.0, float(settings.sse_resume_ttl))
        if tick_interval is not None:
            # 显式传入（测试用）：允许毫秒级，只挡掉 0 与负数
            self._tick = max(0.05, float(tick_interval))
        else:
            configured = _ms_setting("sse_tick_interval", 3000)
            # 配置成 0 / 负数时回退默认值，而不是把保活帧打成每秒几十条
            self._tick = configured if configured >= 1.0 else 3.0
        self._max_bytes = max(64 * 1024, int(max_buffer_bytes))

    # ------------------------------------------------------------------ 状态

    @property
    def done(self) -> bool:
        return self._done

    @property
    def started(self) -> bool:
        return self._started

    @property
    def subscribers(self) -> int:
        return self._subscribers

    @property
    def last_seq(self) -> int:
        return self._last_seq

    @property
    def resumable(self) -> bool:
        return self._resumable

    @property
    def grace(self) -> float:
        return self._grace

    def can_resume_from(self, since: int) -> bool:
        """能否从这个序号接着发。已读到队首的活读者总可以继续，新读者要求缓冲完整。"""
        if since < 0:
            since = 0
        if since > self._last_seq:
            return False
        return self._resumable or since >= self._last_seq

    # ------------------------------------------------------------ 生成侧写入

    def bind_source(self, agen: AsyncGenerator) -> None:
        """绑定路由层那条 async generator。真正开跑要等第一个读者 attach。"""
        self._agen = agen

    def publish(self, event: str, data: str) -> None:
        if self._done:
            return
        self._last_seq += 1
        payload = _BufferedEvent(seq=self._last_seq, event=event, data=data)
        self._events.append(payload)
        self._bytes += len(data.encode("utf-8", "replace")) + len(event) + 24
        if self._bytes > self._max_bytes and self._resumable:
            # 兜底：正常模型输出的量级远到不了这里（max_tokens 撑死十万级字符），
            # 撞上说明上游在异常地狂吐。此刻不能继续无界缓存——进程会先被 OOM 干掉。
            # 先把标志位落下（递归 publish 会走正常分支），给读者一条终止帧，再取消生成。
            self._resumable = False
            logger.error(
                "流事件缓冲超过 %s 字节，终止本次生成：%s", self._max_bytes, self.id
            )
            self.publish(
                "error",
                json.dumps(
                    {
                        "message": "本次输出异常过长，已被服务端截断",
                        "advice": "请把材料拆成两段分别处理，或改用输出上限更高的模型。",
                        "code": "output_overflow",
                    },
                    ensure_ascii=False,
                ),
            )
            self.finish()
            if self._pump_task is not None and not self._pump_task.done():
                self._pump_task.cancel()
        for waiter in tuple(self._waiters):
            waiter.set()

    def publish_dict(self, item: object) -> None:
        if isinstance(item, dict):
            event = str(item.get("event") or "message")
            data = item.get("data")
            self.publish(event, "" if data is None else str(data))
            return
        self.publish("message", str(item))

    # ------------------------------------------------------------ 生命周期

    def attach(self) -> None:
        self._subscribers += 1
        self._attaches += 1
        self._detached_at = None
        if self._attaches > 1:
            # 运维视角：一次请求被网络掐断后真的接回来了。日志里能看到
            # 「这次生成断过但内容没丢」，与上游断流续写的尾注互为补充
            logger.info("客户端重新接上生成流（%s，第 %s 次）", self.id, self._attaches - 1)
        if self._watchdog is not None:
            self._watchdog.cancel()
            self._watchdog = None
        if not self._started and self._agen is not None:
            self._started = True
            self._pump_task = asyncio.create_task(
                self._pump(self._agen), name=f"stream-pump:{self.id}"
            )
            self._pump_task.add_done_callback(self._on_pump_done)

    def detach(self) -> None:
        self._subscribers = max(0, self._subscribers - 1)
        if self._done or self._subscribers:
            return
        self._detached_at = monotonic()
        if self._grace <= 0:
            # 配置为 0：维持老行为，掉线即停。上游可能卡在等首块、根本不看
            # stop_event，所以直接取消生成任务；收尾（扣费、写日志、关上游）
            # 由 _pump 的 finally 用 await_cleanup 保证跑完
            self.stop_event.set()
            if self._pump_task is not None and not self._pump_task.done():
                self._pump_task.cancel()
            return
        if self._watchdog is None:
            self._watchdog = asyncio.create_task(
                self._watch_abandon(), name=f"stream-watch:{self.id}"
            )

    async def _watch_abandon(self) -> None:
        try:
            while not self._done:
                await asyncio.sleep(1.0)
                if self._subscribers or self._done:
                    return
                if self._detached_at is None:
                    self._detached_at = monotonic()
                waited = monotonic() - self._detached_at
                if waited < self._grace:
                    continue
                logger.info(
                    "客户端断开 %.0f 秒仍无人接续，停止本次生成：%s", waited, self.id
                )
                self.stop_event.set()
                await asyncio.sleep(ABANDON_FORCE_CANCEL_SECONDS)
                if not self._done and self._pump_task is not None:
                    logger.warning("生成在停止后仍未退出，强制取消：%s", self.id)
                    self._pump_task.cancel()
                return
        except asyncio.CancelledError:
            return
        except Exception:
            logger.exception("续接看门狗异常（%s）", self.id)
        finally:
            if self._watchdog is asyncio.current_task():
                self._watchdog = None

    async def _pump(self, agen: AsyncGenerator) -> None:
        published = 0
        try:
            async for item in agen:
                self.publish_dict(item)
                published += 1
                # 上游如果连续吐块而中间一次都不 await（例如整段内容已在内存里），
                # 这个任务永远不会把控制权交回事件循环：读者收不到事件、看门狗的
                # 停止信号也送不进来。每 32 条让出一次，顺带保证取消能及时生效。
                if published % 32 == 0:
                    await asyncio.sleep(0)
        except asyncio.CancelledError:
            logger.info("生成任务被取消：%s", self.id)
            raise
        except Exception:
            logger.exception("生成任务异常退出：%s", self.id)
            # 路由层的 event_generator 自己会接住异常并转成 error 事件；能走到这里
            # 说明是更外层的意外。仍要给读者一个终止帧，否则它会一直等下去。
            self.publish(
                "error",
                json.dumps(
                    {"message": "生成意外中断，请重试", "advice": "", "code": "internal"},
                    ensure_ascii=False,
                ),
            )
        finally:
            # 先关生成器：它的 finally 负责扣费、写使用日志、清 _stop_events。
            # 断线/取消都可能重复打断这一步，用 await_cleanup 保证跑完。
            # 无论关闭成功与否，finish() 都必须执行——否则读者会永远等下去
            closed = asyncio.ensure_future(agen.aclose())
            try:
                await await_cleanup(closed)
            except asyncio.CancelledError:
                logger.info("关闭生成器时被取消（%s）", self.id)
            except Exception:
                logger.warning("关闭生成器失败（%s）", self.id, exc_info=True)
            finally:
                self.finish()

    def _on_pump_done(self, task: asyncio.Task) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            logger.error("生成任务未捕获异常（%s）：%r", self.id, exc)

    def finish(self) -> None:
        """生成结束：补一条终止帧（如果生成器没发），并安排过期回收。"""
        if self._done:
            return
        if not self._has_terminal():
            self.publish("done", "[CANCELLED]")
        self._done = True
        self._finished_at = monotonic()
        self._finished_event.set()
        for waiter in tuple(self._waiters):
            waiter.set()
        if self._watchdog is not None:
            self._watchdog.cancel()
            self._watchdog = None
        self._schedule_evict()

    async def wait_finished(self) -> None:
        """等生成真正收尾（含扣费与写日志）。供「掉线即停」模式等待响应结束。"""
        await self._finished_event.wait()

    def _has_terminal(self) -> bool:
        if not self._events:
            return False
        last = self._events[-1]
        return last.event in {"done", "error"} or last.data in {"[DONE]", "[CANCELLED]"}

    def _schedule_evict(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            _sessions.pop(self.id, None)
            return
        if self._evict_handle is not None:
            self._evict_handle.cancel()
        self._evict_handle = loop.call_later(max(0.0, self._ttl), self._evict)

    def _evict(self) -> None:
        if _sessions.get(self.id) is self:
            _sessions.pop(self.id, None)
        self._events.clear()
        self._waiters.clear()

    # ------------------------------------------------------------ 读者侧

    async def stream_from(self, since: int) -> AsyncIterator[dict]:
        """从 `since` 之后接着发。生成结束且发完即返回。"""
        if not self.can_resume_from(since):
            raise ResumeUnavailable("缓冲不完整，无法从该位置续接")
        cursor = max(0, since)
        wake = asyncio.Event()
        self._waiters.add(wake)
        self.attach()
        try:
            # 立刻给一条 meta：客户端据此确认「这条连接真的接上了」，也拿到当前队尾，
            # 不必等第一个 token 才知道续接成功
            yield {
                "event": "resume",
                "data": json.dumps(
                    {"session": self.id, "since": cursor, "last_seq": self._last_seq},
                    ensure_ascii=False,
                ),
            }
            while True:
                wake.clear()
                pending = [e for e in self._events if e.seq > cursor]
                if pending:
                    for buffered in pending:
                        cursor = buffered.seq
                        yield {
                            "event": buffered.event,
                            "data": buffered.data,
                            "id": str(buffered.seq),
                        }
                    continue
                if self._done:
                    return
                try:
                    await asyncio.wait_for(wake.wait(), timeout=self._tick)
                except asyncio.TimeoutError:
                    # 保活帧不带 id：它不属于事件序列，重放时也不需要出现
                    yield {
                        "event": "tick",
                        "data": json.dumps(
                            {"t": round(monotonic() - self.created, 1)}, ensure_ascii=False
                        ),
                    }
        finally:
            self._waiters.discard(wake)
            self.detach()

    def subscribe(self, since: int) -> AsyncIterator[dict]:
        """给 EventSourceResponse 用的同步入口（返回 async iterator）。"""
        return self.stream_from(since)

    # ------------------------------------------------------------ 收尾

    def discard_unstarted(self) -> bool:
        """响应还没开始遍历就断了：生成从未开跑，直接作废。返回是否真的没开跑。"""
        if self._started:
            return False
        self._done = True
        self._finished_at = monotonic()
        self._finished_event.set()
        if _sessions.get(self.id) is self:
            _sessions.pop(self.id, None)
        if self._evict_handle is not None:
            self._evict_handle.cancel()
            self._evict_handle = None
        return True


# ---------------------------------------------------------------- 注册表

def open_session(
    session_id: str,
    owner_code: Optional[str],
    owner_identity: str,
    stop_event: asyncio.Event,
    **kwargs,
) -> StreamSession:
    """注册一条新会话。id 撞车（同 id 的旧会话还没过期）时自动加后缀。"""
    unique = session_id
    suffix = 1
    while unique in _sessions:
        suffix += 1
        unique = f"{session_id}_{suffix}"
    session = StreamSession(unique, owner_code, owner_identity, stop_event, **kwargs)
    _sessions[unique] = session
    return session


def get_session(session_id: str) -> Optional[StreamSession]:
    return _sessions.get(session_id)


def has_session(session_id: str) -> bool:
    return session_id in _sessions


def reset_for_tests() -> None:
    """测试间清空注册表：进程级状态，不隔离会跨用例互相污染。"""
    for session in list(_sessions.values()):
        if session._watchdog is not None:
            session._watchdog.cancel()
        if session._pump_task is not None and not session._pump_task.done():
            session._pump_task.cancel()
        if session._evict_handle is not None:
            session._evict_handle.cancel()
    _sessions.clear()


async def shutdown() -> None:
    """应用关闭：取消所有在途生成任务，别把 loop 关闭时的告警留给运维。"""
    tasks = []
    for session in list(_sessions.values()):
        if session._watchdog is not None:
            session._watchdog.cancel()
        if session._pump_task is not None and not session._pump_task.done():
            session._pump_task.cancel()
            tasks.append(session._pump_task)
        if session._evict_handle is not None:
            session._evict_handle.cancel()
    _sessions.clear()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
