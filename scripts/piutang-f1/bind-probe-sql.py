#!/usr/bin/env python3
"""Cetak SQL probe kesegaran F1 dari SUMBER KANONIKNYA, dengan $n terikat.

⚠️ KENAPA DIEKSTRAK, BUKAN DISALIN. Rumus materialitas ini sebelumnya hidup di
dua tempat: berkas .sql untuk gerbang dan konstanta TypeScript untuk jalur baca.
Dua definisi rumus yang sama adalah dua definisi yang bisa menyimpang diam-diam
— kelas yang sudah dibayar arc ini pada komentar migrasi 0013 dan pada
predikat pemensiunan. Sumber kanoniknya sekarang SATU:
`apps/dashboard/src/lib/saldo-freshness.ts`, yang dipakai produksi. Gerbang
membaca berkas itu, bukan salinannya.

Pemakaian: bind-probe-sql.py <unit> <as_of> <cut_id> <cut_at>
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps/dashboard/src/lib/saldo-freshness.ts"


def canonical_sql() -> str:
    text = SOURCE.read_text(encoding="utf-8")
    match = re.search(r"READ_SALDO_FRESHNESS_SQL = `(.*?)`;", text, re.S)
    if not match:
        sys.exit(f"tidak menemukan READ_SALDO_FRESHNESS_SQL di {SOURCE}")
    sql = match.group(1)
    # Kontrol anti-vakum: ekstraksi yang "berhasil" memulangkan potongan kosong
    # akan membuat gerbang lulus tanpa menguji apa pun.
    if "piut_delta" not in sql or "$4::timestamptz" not in sql:
        sys.exit("SQL terekstrak tidak memuat penanda yang diharapkan — regexnya meleset.")
    return sql


def main() -> None:
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    unit, as_of, cut_id, cut_at = sys.argv[1:5]
    sql = canonical_sql()
    # Urutan mundur supaya $1 tidak menelan $1x. Literal di-quote sederhana;
    # hanya nilai fixture yang lewat sini, tidak pernah masukan pengguna.
    for index, value in ((4, cut_at), (3, cut_id), (2, as_of), (1, unit)):
        literal = value if index == 1 else "'" + value.replace("'", "''") + "'"
        sql = sql.replace(f"${index}", literal)
    print(sql)


if __name__ == "__main__":
    main()
