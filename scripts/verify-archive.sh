#!/usr/bin/env bash
# G4 · Verifikasi arsip PASCA-MERGE — dibaca dari `origin`, bukan dari keyakinan
# bahwa kita sudah menulisnya.
#
# KENAPA ADA: PR #209 ter-merge membawa TIGA klaim yang sudah terbukti salah
# (kontensi pool · dugaan stale-while-revalidate · rasio 2,34%). Commit
# koreksinya mendarat SETELAH merge, jadi arsipnya keliru ~40 menit. Yang
# menyelamatkan cuma ada orang yang ingat — itu bukan proses.
#
# Skrip ini menjawab pertanyaan yang BENAR — "apakah yang TER-MERGE memuatnya" —
# bukan "apakah saya sudah menulisnya".
#
# Pakai:  scripts/verify-archive.sh <branch> <berkas> <penanda…>
# Contoh: scripts/verify-archive.sh staging session-notes/x.md DICABUT KOREKSI
set -euo pipefail
[ $# -ge 3 ] || { echo "pakai: $0 <branch> <berkas> <penanda…>" >&2; exit 2; }
BRANCH=$1; FILE=$2; shift 2
git fetch -q origin "$BRANCH"
CONTENT=$(git show "origin/$BRANCH:$FILE" 2>/dev/null) || {
  echo "❌ $FILE TIDAK ADA di origin/$BRANCH"; exit 1; }
rc=0
for marker in "$@"; do
  if printf '%s' "$CONTENT" | grep -qF -- "$marker"; then
    echo "  ✅ '$marker' ADA di origin/$BRANCH:$FILE"
  else
    echo "  ❌ '$marker' TIDAK ADA — retraksi/koreksi belum benar-benar ter-merge"; rc=1
  fi
done
exit $rc
