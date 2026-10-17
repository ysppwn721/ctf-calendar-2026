#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 PDF 中提取文本，输出为 UTF-8 文本 + 精简清单"""
import sys, re
from pypdf import PdfReader

SRC = r"C:\Users\Administrator\Desktop\中北大学学科竞赛目录（2026版）(1).pdf"
OUT_TXT = r"C:\Users\Administrator\Desktop\ctf-all-in-one\.preview\nuc-competitions.txt"

reader = PdfReader(SRC)
print("pages:", len(reader.pages))

chunks = []
for i, page in enumerate(reader.pages):
    try:
        t = page.extract_text() or ""
    except Exception as e:
        t = f"<<extract error: {e}>>"
    chunks.append(f"\n===== PAGE {i+1} =====\n{t}")

full = "".join(chunks)
with open(OUT_TXT, "w", encoding="utf-8") as f:
    f.write(full)

print("chars:", len(full))
print("preview:")
print(full[:1500])
