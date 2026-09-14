#!/usr/bin/env python3
"""Cetak jumlah unit terdaftar, dari registry kanonik di dashboard config.

Sumbernya `ADOPSI_RINCIAN` — satu-satunya daftar seluruh unit yang ada di kode
(tujuh kode SPBU). Dipakai gerbang cakupan untuk tahu berapa job penjadwal yang
seharusnya ada, tanpa menyentuh database.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps/dashboard/src/lib/config.ts"

text = SOURCE.read_text(encoding="utf-8")
block = re.search(r"export const ADOPSI_RINCIAN[^{]*\{(.*?)\n\};", text, re.S)
if not block:
    sys.exit(f"tidak menemukan ADOPSI_RINCIAN di {SOURCE}")
codes = re.findall(r'"(\d{7,8})"\s*:', block.group(1))
# Kontrol anti-vakum: regex yang berhenti cocok akan memulangkan 0, dan gerbang
# yang menuntut "0 job" lulus tanpa memeriksa apa pun.
if len(codes) < 2:
    sys.exit(f"hanya {len(codes)} unit terbaca dari ADOPSI_RINCIAN — regexnya meleset.")
print(len(codes))
