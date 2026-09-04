"""扫描预检：合成 PDF 代替真机样本，保守断言（负样本零误报优先）。"""

import fitz  # PyMuPDF


def _text_doc(pages: int = 3, chars: int = 800) -> bytes:
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), "English test content. " * (chars // 20), fontsize=11)
    buf = doc.tobytes()
    doc.close()
    return buf


def _full_image_doc(pages: int = 3) -> bytes:
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page()
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 200), False)
        pix.set_rect(pix.irect, (200, 200, 200))
        png = pix.tobytes("png")
        page.insert_image(page.rect, stream=png)
    buf = doc.tobytes()
    doc.close()
    return buf


def test_text_doc_passes():
    from app.services.pdf_scan_check import check_pdf_scanned

    r = check_pdf_scanned(_text_doc())
    assert r["is_scanned"] is False


def test_text_with_vector_graphics_passes():
    from app.services.pdf_scan_check import check_pdf_scanned

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Reading passage with picture. " * 40, fontsize=11)
    page.draw_rect(fitz.Rect(72, 200, 400, 400), color=(1, 0, 0), width=2)
    buf = doc.tobytes()
    doc.close()
    r = check_pdf_scanned(buf)
    assert r["is_scanned"] is False


def test_full_image_doc_flagged():
    from app.services.pdf_scan_check import check_pdf_scanned

    r = check_pdf_scanned(_full_image_doc(3))
    assert r["is_scanned"] is True
    assert r["confidence"] >= 0.9


def test_single_page_image_flagged():
    from app.services.pdf_scan_check import check_pdf_scanned

    r = check_pdf_scanned(_full_image_doc(1))
    assert r["is_scanned"] is True


def test_mixed_doc_passes():
    """混合半扫必须放行（宁可漏报，由空结果二次弹窗补回）。"""
    from app.services.pdf_scan_check import check_pdf_scanned

    doc = fitz.open()
    for _ in range(3):
        page = doc.new_page()
        page.insert_text((72, 72), "Native text page. " * 60, fontsize=11)
    for _ in range(2):
        page = doc.new_page()
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 200), False)
        png = pix.tobytes("png")
        page.insert_image(page.rect, stream=png)
    buf = doc.tobytes()
    doc.close()
    r = check_pdf_scanned(buf)
    assert r["is_scanned"] is False


def test_garbage_bytes_pass_through():
    from app.services.pdf_scan_check import check_pdf_scanned

    r = check_pdf_scanned(b"not a pdf at all")
    assert r["is_scanned"] is False


def test_fail_open_on_error(monkeypatch):
    import app.services.pdf_scan_check as mod

    monkeypatch.setattr("fitz.open", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    r = mod.check_pdf_scanned(b"%PDF-1.4 fake")
    assert r["is_scanned"] is False
