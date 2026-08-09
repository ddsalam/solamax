#!/usr/bin/env bash
# Self-test penjaga berkas cadangan — TIGA keadaan, termasuk cabang anti-vakum
# yang tanpa seam `DAFTAR` tak akan pernah bisa dimerahkan.
set -euo pipefail
cd "$(dirname "$0")"
PENJAGA=./check-backup-files.sh
gagal=0

# 200 nama berkas wajar — di atas ambang anti-vakum.
WAJAR=$(for i in $(seq 1 200); do echo "src/modul$i.ts"; done)

periksa() {
  local nama="$1" rc_harap="$2" wajib="$3" daftar="$4"
  local out rc
  out=$(DAFTAR="$daftar" bash "$PENJAGA" 2>&1) && rc=0 || rc=$?
  if [ "$rc" != "$rc_harap" ]; then echo "  ✗ $nama — rc=$rc, diharapkan $rc_harap"; gagal=1; return; fi
  if ! printf '%s' "$out" | grep -qF "$wajib"; then
    echo "  ✗ $nama — pesan tak memuat: $wajib"; gagal=1; return; fi
  echo "  ✓ $nama (rc=$rc)"
}

echo "self-test penjaga berkas cadangan:"
periksa "repo bersih → LOLOS" 0 "tak ada artefak cadangan" "$WAJAR"
periksa "satu .bak ter-track → TOLAK + cara memperbaikinya" 1 "git rm --cached" \
  "$WAJAR
apps/dashboard/src/lib/compliance.ts.bak"
periksa "akhiran lain juga tertangkap (.orig)" 1 "git rm --cached" \
  "$WAJAR
apps/backend/prisma/x.sql.orig"
# Cabang anti-vakum: daftar yang menciut TIDAK boleh lolos sebagai "aman".
periksa "daftar menciut (5 berkas) → TOLAK, bukan diam" 1 "tak bisa berbunyi" \
  "a.ts
b.ts
c.ts
d.ts
e.ts"

if [ "$gagal" != 0 ]; then echo "self-test cadangan: GAGAL"; exit 1; fi
echo "self-test cadangan: 4 keadaan lulus (termasuk cabang anti-vakum)."
