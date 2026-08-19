#!/usr/bin/env bash
# Self-test untuk scripts/mutasi.sh — alat ukur pun butuh alat ukur.
#
# ⛔ Ia MEMANGGIL helper yang sebenarnya terhadap berkas tiruan, bukan meniru
# logikanya. Self-test yang meniru hanya menguji tiruannya (pelajaran dari
# check-sql-syntax.selftest.sh).
#
# ⚠️ Catatan bentuk: keluaran ditangkap ke BERKAS, bukan lewat `$(...)`.
# Substitusi perintah menjalankan helper di SUBSHELL, sehingga penanda seperti
# `DIJALANKAN=1` tak pernah merambat ke sini — dan self-test-nya akan melaporkan
# helper gagal padahal yang cacat cara mengukurnya. (Terjadi saat berkas ini
# ditulis.)
set -uo pipefail
cd "$(dirname "$0")/../.."
. scripts/mutasi.sh

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
OUT="$TMP/keluaran"
GAGAL=0
periksa() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — harap [$2] dapat [$3]"; GAGAL=1; fi; }
memuat() { grep -qF "$1" "$OUT" && echo ya || echo tidak; }

# ── 1 & 3: mutasi menempel → uji dijalankan, lalu berkas pulih ──────────────
printf 'halo dunia\n' > "$TMP/a.txt"
SEBELUM="$(cat "$TMP/a.txt")"
DIJALANKAN=0
mutasi_run() { DIJALANKAN=1; echo "uji-dijalankan"; }
mutasi "menempel" "$TMP/a.txt" 's/halo/hai/' > "$OUT" 2>&1
periksa "mutasi menempel → uji dijalankan" "1" "$DIJALANKAN"
periksa "keluarannya memuat hasil uji" "ya" "$(memuat uji-dijalankan)"
periksa "berkas PULIH identik" "$SEBELUM" "$(cat "$TMP/a.txt")"

# ── 2: mutasi TIDAK menempel → dilaporkan, uji TIDAK dijalankan ─────────────
DIJALANKAN=0
mutasi "tak-menempel" "$TMP/a.txt" 's/kata-yang-tak-ada/x/' > "$OUT" 2>&1
periksa "mutasi tak menempel → uji TIDAK dijalankan" "0" "$DIJALANKAN"
periksa "dan itu DILAPORKAN" "ya" "$(memuat 'TIDAK MENEMPEL')"

# ── 4: GAGAL PULIH terdeteksi ───────────────────────────────────────────────
# Berkas dibuat hanya-baca SESUDAH cadangan diambil, sehingga `cp` pemulihan
# gagal — persis kelas kegagalan yang dua kali lolos diam-diam di arc ini.
printf 'asli\n' > "$TMP/b.txt"
mutasi_run() { chmod 444 "$TMP/b.txt"; echo uji; }
mutasi "gagal-pulih" "$TMP/b.txt" 's/asli/berubah/' > "$OUT" 2>&1
STATUS=$?
chmod 644 "$TMP/b.txt" 2>/dev/null || true
periksa "GAGAL PULIH dilaporkan" "ya" "$(memuat 'GAGAL PULIH')"
periksa "GAGAL PULIH berstatus bukan-nol" "2" "$STATUS"

# ── 5: DUA berkas berurutan → masing-masing pulih ke ISINYA SENDIRI ─────────
# ⛔ Inilah kelas cacat ASLINYA (kegagalan #1 di arc ini): cadangan yang dipakai
# ulang lintas berkas. Tanpa kasus ini, helper yang memakai satu path cadangan
# tetap LULUS self-test — dan uji mutasi M4 membuktikan itu terjadi.
printf 'isi-A\n' > "$TMP/c1.txt"
printf 'isi-B\n' > "$TMP/c2.txt"
mutasi_run() { echo uji; }
mutasi "dua-berkas-1" "$TMP/c1.txt" 's/isi-A/rusak/' > "$OUT" 2>&1
mutasi "dua-berkas-2" "$TMP/c2.txt" 's/isi-B/rusak/' > "$OUT" 2>&1
periksa "berkas pertama pulih ke isinya sendiri" "isi-A" "$(cat "$TMP/c1.txt")"
periksa "berkas kedua pulih ke isinya sendiri" "isi-B" "$(cat "$TMP/c2.txt")"

# ── berkas hilang → dilaporkan, bukan diam ──────────────────────────────────
mutasi_run() { echo uji; }
mutasi "hilang" "$TMP/tak-ada.txt" 's/a/b/' > "$OUT" 2>&1
periksa "berkas tak ada → dilaporkan" "ya" "$(memuat 'BERKAS TIDAK ADA')"

if [ "$GAGAL" -eq 0 ]; then
  echo "OK: scripts/mutasi.sh lulus self-test (9 jaminan)."
else
  echo "GAGAL: scripts/mutasi.sh tidak memenuhi jaminannya."; exit 1
fi
