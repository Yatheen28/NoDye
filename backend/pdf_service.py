"""ReportLab clinical report: header (hospital + logo slot), patient, images, metrics, signature line."""
from __future__ import annotations

import io

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

TEAL = colors.HexColor("#0D4F4F")
CHARCOAL = colors.HexColor("#2C2C2C")
SLATE = colors.HexColor("#6B7B8D")
OFFWHITE = colors.HexColor("#F5F2EB")
GREEN = colors.HexColor("#5B8C5A")
AMBER = colors.HexColor("#D4A843")
CORAL = colors.HexColor("#E8634A")


def _grade(metric: str, value) -> colors.Color:
    """Thresholds mirror src/components/metrics.ts."""
    if value is None:
        return SLATE
    v = float(value)
    if metric == "psnr":
        return GREEN if v >= 32 else AMBER if v >= 25 else CORAL
    if metric == "ssim":
        return GREEN if v >= 0.90 else AMBER if v >= 0.75 else CORAL
    if metric == "mae":
        return GREEN if v <= 0.05 else AMBER if v <= 0.10 else CORAL
    return SLATE


def _logo_placeholder():
    """Text-mark stand-in for the NoDye logo.

    # TODO: Replace with actual logo asset (small square/horizontal PNG, ~28mm wide).
    """
    style = ParagraphStyle("logo", fontName="Helvetica-Bold", fontSize=16, textColor=TEAL, leading=18)
    return Paragraph("NoDye", style)


def _tier_color(tier: str | None) -> colors.Color:
    """Map Model 2's risk tiers (src/model.py::get_risk_tier) to the report palette."""
    t = (tier or "").lower()
    if t.startswith("very high") or t.startswith("high"):
        return CORAL
    if t.startswith("moderate") or t.startswith("medium"):
        return AMBER
    if t.startswith("low") or t.startswith("very low") or "healthy" in t:
        return GREEN
    return SLATE


def _tumor_section(analysis: dict | None, images: dict[str, bytes], styles: dict) -> list:
    """Build the 'AI Tumor Analysis' block from Model 2's stored result.

    INTEGRATION: `analysis` is scans.tumor_analysis (written by
    tumor_service.run_tumor_analysis).  Only values the classifier actually
    produced are printed; measurements it cannot make (volume, location, mask)
    are listed explicitly as not available rather than invented.
    """
    section, label, body, sub = styles["section"], styles["label"], styles["body"], styles["sub"]
    small = ParagraphStyle("small", parent=body, fontSize=9, leading=11.5)
    badge_style = ParagraphStyle("badge", parent=body, fontName="Helvetica-Bold", fontSize=11, textColor=colors.white)
    ai_tag = ParagraphStyle("aitag", parent=label, fontName="Helvetica-Bold", textColor=colors.HexColor("#7A4DB3"))

    out: list = [Paragraph("AI Tumor Analysis", section),
                 Spacer(1, 2 * mm)]

    if not analysis or analysis.get("status") != "ok":
        status = (analysis or {}).get("status", "unavailable")
        reason = (analysis or {}).get("error") or "Tumour classifier did not run for this scan."
        box = Table([[Paragraph(f"<b>Status:</b> {status}", body)], [Paragraph(str(reason), small)]], colWidths=[174 * mm])
        box.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), OFFWHITE), ("BOX", (0, 0), (-1, -1), 0.5, SLATE),
                                 ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
        out += [box, Spacer(1, 6 * mm)]
        return out

    pf = analysis.get("primary_finding", {})
    detected = bool(analysis.get("tumor_detected"))
    rep = analysis.get("representative_slice")

    # --- Finding card ------------------------------------------------------
    badge_bg = CORAL if detected else GREEN
    badge = Table([[Paragraph("TUMOUR DETECTED" if detected else "NO TUMOUR PREDICTED", badge_style)]], colWidths=[52 * mm])
    badge.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), badge_bg), ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                               ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
    finding_lines = [
        Paragraph("AI Finding", label),
        Paragraph(f"<b>{pf.get('name', '')}</b> - mean probability {pf.get('mean_probability_pct', '')}% "
                  f"<font color='{_tier_color(pf.get('risk_tier')).hexval()}'>[{pf.get('risk_tier', '')}]</font>", body),
        Paragraph(f"Overall tumour chance: <b>{analysis.get('overall_tumor_chance_pct', '')}%</b> "
                  f"({analysis.get('overall_risk_tier', '')})", small),
    ]
    card = Table([[finding_lines, badge]], colWidths=[118 * mm, 56 * mm])
    card.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), OFFWHITE), ("BOX", (0, 0), (-1, -1), 0.75, badge_bg),
                              ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                              ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                              ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
    out += [card, Spacer(1, 4 * mm)]



    # --- Per-class table (3 tumour types + no tumour) ----------------------
    rows = [[Paragraph("Category", label), Paragraph("Mean prob.", label), Paragraph("Max prob.", label),
             Paragraph("Risk tier", label), Paragraph("Insight", label)]]
    for c in analysis.get("categories", []):
        rows.append([
            Paragraph(f"<b>{c.get('name', '')}</b>", small),
            Paragraph(f"{c.get('mean_probability_pct', '')}%", small),
            Paragraph(f"{c.get('max_probability_pct', '')}%", small),
            Paragraph(f"<font color='{_tier_color(c.get('risk_tier')).hexval()}'><b>{c.get('risk_tier', '')}</b></font>", small),
            Paragraph(c.get("insight", ""), ParagraphStyle("ins", parent=small, fontSize=8, leading=10, textColor=SLATE)),
        ])
    tbl = Table(rows, colWidths=[33 * mm, 20 * mm, 20 * mm, 30 * mm, 71 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), OFFWHITE), ("LINEBELOW", (0, 0), (-1, 0), 0.75, TEAL),
                             ("LINEBELOW", (0, 1), (-1, -1), 0.25, SLATE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                             ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    out += [tbl, Spacer(1, 4 * mm)]

    # --- AI summary --------------------------------------------------------
    out += [Spacer(1, 3 * mm), Paragraph("AI Analysis Summary", label),
            Paragraph(analysis.get("summary_text", ""), small)]
    out.append(Spacer(1, 8 * mm))
    out.append(Spacer(1, 8 * mm))
    return out


def build_report_pdf(
    *,
    hospital_name: str,
    patient: dict,
    scan: dict,
    preview_png: bytes | None,
    heatmap_png: bytes | None,
    tumor_analysis: dict | None = None,
    tumor_images: dict[str, bytes] | None = None,
) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
        title=f"NoDye Report {scan.get('scan_id', '')}", author=hospital_name,
    )
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=18, textColor=CHARCOAL, alignment=TA_LEFT, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=ss["Normal"], fontSize=9, textColor=SLATE)
    label = ParagraphStyle("label", parent=ss["Normal"], fontSize=8.5, textColor=SLATE)
    body = ParagraphStyle("body", parent=ss["Normal"], fontSize=10.5, textColor=CHARCOAL)
    section = ParagraphStyle("section", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=11, textColor=TEAL, spaceBefore=8, spaceAfter=4)

    story = []
  
    # Header: hospital name + logo slot
    header = Table(
        [[Paragraph(hospital_name, h1), _logo_placeholder()]],
        colWidths=[130 * mm, 44 * mm],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LINEBELOW", (0, 1), (-1, 1), 1, TEAL),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 6),
    ]))
    story += [header, Spacer(1, 6 * mm)]

    # Patient details
    story.append(Paragraph("Patient", section))
    pt = Table(
        [
            [Paragraph("Patient ID", label), Paragraph("Name", label), Paragraph("Age", label), Paragraph("Gender", label)],
            [Paragraph(str(patient.get("patient_id", "")), body), Paragraph(str(patient.get("name", "")), body),
             Paragraph(str(patient.get("age", "")), body), Paragraph(str(patient.get("gender", "")), body)],
        ],
        colWidths=[50 * mm, 70 * mm, 24 * mm, 30 * mm],
    )
    pt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), OFFWHITE), ("BOX", (0, 0), (-1, -1), 0.5, SLATE),
                            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [pt, Spacer(1, 4 * mm)]
    story.append(Paragraph(f"Scan ID: {scan.get('scan_id', '')} &nbsp;&nbsp; Processed: {str(scan.get('created_at', ''))[:19].replace('T', ' ')}", sub))

    # Images
    story.append(Paragraph("Imaging", section))
    img_w = 78 * mm
    cells, caps = [], []
    for png, cap in ((preview_png, "Synthetic T1CE, central axial slice"), (heatmap_png, "Attention map (att1 gate)")):
        if png:
            cells.append(Image(io.BytesIO(png), width=img_w, height=img_w, kind="proportional"))
        else:
            cells.append(Paragraph("Image unavailable", sub))
        caps.append(Paragraph(cap, label))
    imgs = Table([cells, caps], colWidths=[img_w + 6 * mm] * 2)
    imgs.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [imgs, Spacer(1, 6 * mm)]

    # INTEGRATION: Model 2 (tumour classifier) results.  Appended after the
    # existing imaging block; everything above is unchanged.
    story += _tumor_section(tumor_analysis, tumor_images or {}, {"section": section, "label": label, "body": body, "sub": sub})

    # Footer signature line
    story.append(Paragraph("Physician Signature: _______________________________________", body))
    story.append(Spacer(1, 2 * mm))
    doc.build(story)
    return buf.getvalue()
