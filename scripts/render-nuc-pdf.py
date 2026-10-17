#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 PDF 每页渲染成 PNG，供视觉读取"""
import pymupdf, os

SRC = r"C:\Users\Administrator\Desktop\中北大学学科竞赛目录（2026版）(1).pdf"
OUT = r"C:\Users\Administrator\Desktop\ctf-all-in-one\.preview\nuc"
os.makedirs(OUT, exist_ok=True)

doc = pymupdf.open(SRC)
print("pages:", doc.page_count)
for i, page in enumerate(doc):
    r = page.rect
    print(f"page {i+1}: {r.width:.0f} x {r.height:.0f} pt")
    # 200 DPI 保证中文清晰
    pix = page.get_pixmap(dpi=200)
    path = os.path.join(OUT, f"p{i+1:02d}.png")
    pix.save(path)
    print(f"  -> {path}  {pix.width}x{pix.height}  {os.path.getsize(path)} bytes")
