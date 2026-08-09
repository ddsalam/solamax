#!/usr/bin/env bash
# Self-test gerbang G4 — EMPAT keadaan, termasuk yang HIJAU.
#
# ⚠️ Ini yang tak ada pada versi pertama. Gerbang itu dibuktikan bisa MERAH lalu
# dinyatakan "terpasang" — padahal jalur hijaunya mustahil, karena label
# pelepasnya belum dibuat. Membuktikan MERAH tanpa membuktikan HIJAU adalah
# setengah bukti, dan setengah yang hilang justru yang membuat gerbang itu
# terpakai atau ditinggalkan orang.
#
# Ia memanggil skrip yang SAMA dengan yang dipanggil workflow — bukan tiruannya.

set -euo pipefail
cd "$(dirname "$0")"
GERBANG=./check-arsip-g4.sh
gagal=0

# $1 nama · $2 rc yang diharapkan · $3 potongan pesan wajib · sisanya env
periksa() {
  local nama="$1" rc_harap="$2" wajib="$3"; shift 3
  local out rc
  out=$(env "$@" bash "$GERBANG" 2>&1) && rc=0 || rc=$?
  if [ "$rc" != "$rc_harap" ]; then
    echo "  ✗ $nama — rc=$rc, diharapkan $rc_harap"; gagal=1; return
  fi
  if ! printf '%s' "$out" | grep -qF "$wajib"; then
    echo "  ✗ $nama — pesan tak memuat: $wajib"; echo "$out" | sed 's/^/      /'; gagal=1; return
  fi
  echo "  ✓ $nama (rc=$rc)"
}

echo "self-test gerbang G4:"

periksa "tak menyentuh arsip → LOLOS" 0 "G4 tak berlaku" \
  BERUBAH= LABELS= LABEL_ADA=true BASE_REF=staging HEAD_REF=fitur

# ── Pengecualian PR promosi — diuji pada keadaan LOLOS, bukan hanya tolak.
# Pengecualian yang tak pernah dilihat bekerja adalah artefak yang sama dengan
# label yang tak pernah dibuat.
periksa "promosi staging→main + arsip berubah, TANPA label → LOLOS" 0 "G4 dikecualikan" \
  BERUBAH=session-notes/x.md LABELS= LABEL_ADA=true BASE_REF=main HEAD_REF=staging

periksa "base main tapi head BUKAN staging → tetap TOLAK (bypass ditutup)" 1 "belum dinyatakan bertahan" \
  BERUBAH=session-notes/x.md LABELS= LABEL_ADA=true BASE_REF=main HEAD_REF=fitur-nakal

periksa "head staging tapi base BUKAN main → tetap TOLAK" 1 "belum dinyatakan bertahan" \
  BERUBAH=session-notes/x.md LABELS= LABEL_ADA=true BASE_REF=rilis HEAD_REF=staging

periksa "arsip berubah, LABEL BELUM DIBUAT → TOLAK + cara membuatnya" 1 "gh label create" \
  BERUBAH=session-notes/x.md LABELS= LABEL_ADA=false BASE_REF=staging HEAD_REF=fitur

periksa "arsip berubah, label ada tapi belum dipasang → TOLAK" 1 "belum dinyatakan bertahan" \
  BERUBAH=session-notes/x.md LABELS=bug,dokumentasi LABEL_ADA=true BASE_REF=staging HEAD_REF=fitur

# ── JALUR HIJAU: yang tak pernah terbukti pada versi pertama ──
periksa "arsip berubah + label terpasang → LOLOS" 0 "dinyatakan terpenuhi" \
  BERUBAH=session-notes/x.md LABELS=dokumentasi,arsip-siklus-kedua LABEL_ADA=true BASE_REF=staging HEAD_REF=fitur

# Label yang MIRIP tak boleh lolos (pencocokan harus persis, bukan substring).
periksa "label mirip ('arsip-siklus-kedua-lah') tidak melepas" 1 "belum dinyatakan bertahan" \
  BERUBAH=session-notes/x.md LABELS=arsip-siklus-kedua-lah LABEL_ADA=true BASE_REF=staging HEAD_REF=fitur

if [ "$gagal" != 0 ]; then
  echo "self-test G4: GAGAL"; exit 1
fi
echo "self-test G4: 8 keadaan lulus (termasuk jalur hijau & pengecualian promosi)."
