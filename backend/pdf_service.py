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


def build_report_pdf(*, hospital_name: str, patient: dict, scan: dict, preview_png: bytes | None, heatmap_png: bytes | None) -> bytes:
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
    story += [imgs, Spacer(1, 14 * mm)]

    # Footer signature line
    story.append(Paragraph("Physician Signature: _______________________________________", body))
    story.append(Spacer(1, 2 * mm))
    doc.build(story)
    return buf.getvalue()
