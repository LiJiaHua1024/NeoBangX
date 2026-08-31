"""统一使用日志写入与保留清理。

设计约定：
- 元数据（状态、耗时、tokens、IP/UA）对每次 LLM 调用始终记录；
- 原始数据（用户输入 / 渲染 Prompt / 输出）写入独立的 log_payloads 表，
  仅在运行时配置 log_payload 开启时落库；
- 一次 LLM 调用 = 一条 usage_logs 记录，写入失败只记日志、绝不影响主请求。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import LogPayload, UsageLog
from app.services.runtime_config import get_config_value

logger = logging.getLogger(__name__)

STATUS_SUCCESS = "success"
STATUS_CANCELLED = "cancelled"
STATUS_ERROR = "error"

# 单段原始数据与错误信息的落库截断上限：正常生成远小于此，
# 仅防异常超长输入把 SQLite 单行体积撑大
MAX_PAYLOAD_CHARS = 60_000
MAX_ERROR_CHARS = 500


def legacy_status_clause():
    """旧库行的「无状态」形态：升级前写入的记录没有 status 列。

    `_add_missing_columns()` 以可空、无默认值的方式 ALTER 加列，因此存量行
    读回是 NULL；若某次升级前 ORM 曾以空串写入，也一并归入此类。
    """
    return or_(UsageLog.status.is_(None), UsageLog.status == "")


def status_matches(status: str):
    """状态匹配规则 —— 列表筛选、聚合统计与详情展示必须共用这一条。

    存量记录一律按 success 归档（旧代码只在生成收尾并扣费后写日志，
    异常与用户停止当时根本不留痕）。若此处与展示层的收敛不一致，
    就会出现「详情写着成功、筛成功却查不到」的矛盾。
    """
    if status == STATUS_SUCCESS:
        return or_(UsageLog.status == STATUS_SUCCESS, legacy_status_clause())
    return UsageLog.status == status


def _clip(value: str | None, limit: int) -> str:
    return (value or "")[:limit]


def get_client_info(request: Request | None) -> tuple[str, str]:
    """提取客户端 IP 与 User-Agent。

    部署在反代（nginx 等）之后时优先取转发头：X-Real-IP >
    X-Forwarded-For 首跳 > 直连地址。
    """
    if request is None:
        return "", ""
    ip = request.headers.get("x-real-ip", "").strip().split(",")[0].strip()
    if not ip:
        forwarded = request.headers.get("x-forwarded-for", "").strip()
        if forwarded:
            ip = forwarded.split(",")[0].strip()
    if not ip and request.client is not None:
        ip = (request.client.host or "").strip()
    ua = request.headers.get("user-agent", "").strip()
    return ip[:64], ua[:255]


def record_usage_log(
    *,
    code_id: int,
    code: str,
    tool_id: str = "",
    tool_name: str = "",
    model: str = "",
    request_id: str = "",
    status: str = STATUS_SUCCESS,
    error_message: str = "",
    duration_ms: int | None = None,
    usage: dict | None = None,
    ip: str = "",
    user_agent: str = "",
    units: int = 0,
    input_text: str | None = None,
    rendered_prompt: str | None = None,
    output_text: str | None = None,
    log_payload: bool = False,
) -> int | None:
    """写一条使用日志（含开关控制的原始数据）。

    同步函数，独立短会话，供 asyncio.to_thread 调用；
    返回日志 ID，任何写库异常都被吞掉并返回 None。
    """
    try:
        usage = usage or {}
        db = SessionLocal()
        try:
            log = UsageLog(
                code_id=code_id,
                code=code or "",
                tool_id=tool_id or "",
                tool_name=tool_name or "",
                model=model or "",
                request_id=request_id or "",
                status=status or STATUS_SUCCESS,
                error_message=_clip(error_message, MAX_ERROR_CHARS),
                duration_ms=duration_ms,
                prompt_tokens=usage.get("prompt_tokens"),
                completion_tokens=usage.get("completion_tokens"),
                total_tokens=usage.get("total_tokens"),
                tokens_estimated=bool(usage.get("estimated")),
                ip=ip or "",
                user_agent=user_agent or "",
                units=max(0, int(units or 0)),
            )
            db.add(log)
            db.flush()  # 先取 log.id 再挂 1:1 原始数据
            if log_payload:
                db.add(LogPayload(
                    log_id=log.id,
                    input=_clip(input_text, MAX_PAYLOAD_CHARS),
                    prompt=_clip(rendered_prompt, MAX_PAYLOAD_CHARS),
                    output=_clip(output_text, MAX_PAYLOAD_CHARS),
                ))
            db.commit()
            return log.id
        finally:
            db.close()
    except Exception:
        logger.exception("Failed to record usage log (request=%s)", request_id)
        return None


def purge_expired_logs(db: Session, days: int) -> int:
    """删除保留期之外的使用日志（含原始数据），返回删除的日志条数。

    days <= 0 表示永久保留，直接跳过。
    """
    if days <= 0:
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).replace(tzinfo=None)
    expired_ids = select(UsageLog.id).where(UsageLog.created_at < cutoff)
    db.execute(delete(LogPayload).where(LogPayload.log_id.in_(expired_ids)))
    deleted = (
        db.query(UsageLog)
        .filter(UsageLog.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def current_retention_days(db: Session) -> int:
    """读取当前生效的日志保留天数配置（0 = 永久保留）。"""
    from app.services.runtime_config import parse_log_settings

    _, days = parse_log_settings({"log_retention_days": get_config_value(db, "log_retention_days", "0")})
    return days


def purge_expired_logs_standalone(days: int) -> int:
    """自带会话的清理入口，供后台定时任务调用。"""
    if days <= 0:
        return 0
    db = SessionLocal()
    try:
        return purge_expired_logs(db, days)
    finally:
        db.close()
