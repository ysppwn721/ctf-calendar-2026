#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""用 PyMuPDF 提取中北大学学科竞赛目录（2026版）"""
import pymupdf, re, json

SRC = r"C:\Users\Administrator\Desktop\中北大学学科竞赛目录（2026版）(1).pdf"
OUT_TXT = r"C:\Users\Administrator\Desktop\ctf-all-in-one\.preview\nuc-competitions.txt"

doc = pymupdf.open(SRC)
print("pages:", doc.page_count)

parts = []
for i, page in enumerate(doc):
    t = page.get_text("text")
    parts.append(f"\n===== PAGE {i+1} =====\n{t}")

full = "".join(parts)
with open(OUT_TXT, "w", encoding="utf-8") as f:
    f.write(full)

print("chars:", len(full))
# 检查是否仍有乱码迹象
cjk = len(re.findall(r'[\u4e00-\u9fff]', full))
print("CJK chars:", cjk)
print("---- preview ----")
print(full[:2000])
