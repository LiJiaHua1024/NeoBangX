"""拍照/扫描版 PDF 本地预检（保守优先：宁可放过，不可误报）。

漏报由 MinerU 空结果二次弹窗补回，所以这里只求"报出来的一定准"：
- Word/WPS 导出文字版 → 快速通道放行
- 原生含大插图试卷 → 文字层高 → 不命中
- 单词卡/字帖（每页字少）→ 无大图覆盖 → 不命中
- 混合 PDF（封面图 + 内文）→ 要求全命中 → 放行
- 空白/加密/损坏 → 放行（交损坏分支处理，不判扫描）
- 检测器任何异常/超时 → fail-open 放行
"""

from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

# 单页命中阈值（保守）
_PAGE_TEXT_LIMIT = 50
_PAGE_COVER_RATIO = 0.8
_PAGE_DRAWINGS_LIMIT = 3
_LARGE_IMAGE_RATIO = 0.5

# 整文档判定
_DOC_TOTAL_TEXT_LIMIT = 120
_MIN_CONFIDENCE = 0.9

# 单页 PDF 加严
_SINGLE_TEXT_MUST_BE_ZERO = True
_SINGLE_COVER_RATIO = 0.9

# 快速通道：前 2 页文本均 > 该值 → 直接放行
_FAST_PATH_TEXT = 500

# 总预算秒数（超时放行）
_BUDGET_SECONDS = 2.0


def check_pdf_scanned(file_bytes: bytes) -> dict:
    """判断 PDF 是否极大概率为拍照/扫描件。

    返回 {is_scanned, confidence, evidence}；任何异常一律放行。
    """
    empty = {"is_scanned": False, "confidence": 0.0, "evidence": {}}
    try:
        import fitz  # PyMuPDF
    except Exception as e:
        logger.warning("pdf scan check skipped: pymupdf unavailable (%s)", e)
        return empty
    deadline = time.monotonic() + _BUDGET_SECONDS
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        # 损坏/加密走损坏分支，不判扫描
        logger.info("pdf scan check: open failed, pass through (%s)", e)
        return empty
    try:
        if getattr(doc, "needs_pass", False) or getattr(doc, "is_encrypted", False):
            return empty
        n = doc.page_count
        if n <= 0:
            return empty

        def timed_out() -> bool:
            return time.monotonic() > deadline

        # 快速通道：前两页文本丰富 → 原生文字版
        try:
            fast_texts = []
            for i in range(min(2, n)):
                if timed_out():
                    return empty
                fast_texts.append(len(doc[i].get_text().strip()))
            if len(fast_texts) == 2 and all(t > _FAST_PATH_TEXT for t in fast_texts):
                return {**empty, "evidence": {"fast_path": True, "total_text": sum(fast_texts)}}
        except Exception:
            pass

        # 抽样：最多 5 页
        idx = [0, 1, 2, n // 2, n - 1]
        sample = []
        for i in idx:
            if 0 <= i < n and i not in sample:
                sample.append(i)
            if len(sample) >= 5:
                break

        hits = 0
        total_text = 0
        text_list: list[int] = []
        cover_list: list[float] = []
        has_large = False
        for pi in sample:
            if timed_out():
                logger.warning("pdf scan check timeout, pass through")
                return empty
            page = doc[pi]
            try:
                text_chars = len(page.get_text().strip())
            except Exception:
                text_chars = 0
            try:
                rect = page.rect
                page_area = float(rect.width * rect.height) or 1.0
            except Exception:
                page_area = 1.0
            image_area = 0.0
            large = False
            try:
                images = page.get_images(full=True) or []
            except Exception:
                images = []
            try:
                for img in images:
                    xref = img[0]
                    try:
                        rects = page.get_image_rects(xref) or []
                    except Exception:
                        rects = []
                    if not rects:
                        continue
                    for r in rects:
                        try:
                            a = float(r.width * r.height)
                        except Exception:
                            continue
                        if a <= 0:
                            continue
                        image_area += a
                        if a / page_area > _LARGE_IMAGE_RATIO:
                            large = True
                if images and image_area <= 0:
                    # 取不到包围盒但确有图片：保守估计 0.5，避免漏算
                    image_area = page_area * 0.5
            except Exception:
                pass
            ratio = min(1.0, image_area / page_area) if page_area else 0.0
            try:
                drawings = len(page.get_drawings())
            except Exception:
                drawings = 0
            text_list.append(text_chars)
            cover_list.append(round(ratio, 3))
            total_text += text_chars
            if large:
                has_large = True
            page_hit = (
                text_chars <= _PAGE_TEXT_LIMIT
                and (ratio >= _PAGE_COVER_RATIO or large)
                and drawings <= _PAGE_DRAWINGS_LIMIT
            )
            if page_hit:
                hits += 1

        evidence = {
            "sampled": len(sample),
            "hit": hits,
            "avg_text": round(total_text / len(sample), 1) if sample else 0,
            "avg_cover": round(sum(cover_list) / len(cover_list), 3) if cover_list else 0,
            "total_text": total_text,
            "texts": text_list,
            "covers": cover_list,
        }
        # 单页加严
        if n == 1:
            t0 = text_list[0] if text_list else 0
            c0 = cover_list[0] if cover_list else 0
            if _SINGLE_TEXT_MUST_BE_ZERO and not (t0 == 0 and c0 >= _SINGLE_COVER_RATIO):
                return {"is_scanned": False, "confidence": 0.0, "evidence": evidence}
            if t0 == 0 and c0 >= _SINGLE_COVER_RATIO:
                conf = 0.92
                return {"is_scanned": True, "confidence": conf, "evidence": evidence}
            return {"is_scanned": False, "confidence": 0.0, "evidence": evidence}

        hit_ratio = hits / len(sample) if sample else 0
        all_hit = hits == len(sample) and len(sample) > 0
        confidence = min(0.95, 0.7 + 0.1 * hit_ratio + (0.1 if total_text == 0 else 0) + (0.05 if all_hit else 0))
        is_hit = (
            hit_ratio >= 1.0
            and total_text <= _DOC_TOTAL_TEXT_LIMIT
            and has_large
            and confidence >= _MIN_CONFIDENCE
        )
        return {"is_scanned": bool(is_hit), "confidence": round(confidence, 3), "evidence": evidence}
    except Exception as e:
        logger.warning("pdf scan check failed, pass through: %s", e)
        return empty
    finally:
        try:
            doc.close()
        except Exception:
            pass
