#!/usr/bin/env bash
# Guard tabrakan migrasi Prisma (dijalankan di CI, job `check`).
#
# Latar: repo ini pernah mengalami tabrakan nomor migrasi (0012/0013 dibuat
# paralel di dua branch, diperbaiki rename manual + edit _prisma_migrations).
# CD mengandalkan `prisma migrate deploy` — tabrakan/urutan salah harus mati
# DI CI SEBELUM merge, bukan saat migrasi jalan di pipeline.
#
# Cek:
#  1. Semua direktori migrasi berprefiks NNNN_ (4 digit).
#  2. Tidak ada nomor duplikat. (Check PR berjalan di merge-preview GitHub,
#     jadi dua branch yang sama-sama menambah 0018_… ketahuan SEBELUM merge.)
#  3. Khusus PR: migrasi BARU harus bernomor lebih besar dari semua migrasi di
#     branch tujuan (branch basi yang menambah nomor lama → gagal; konvensi:
#     rebase ke `staging` dulu sebelum menambah migrasi).
set -euo pipefail

MIG_DIR="apps/backend/prisma/migrations"

names=$(find "$MIG_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)

bad=$(echo "$names" | grep -vE '^[0-9]{4}_' || true)
if [ -n "$bad" ]; then
  echo "::error::Direktori migrasi tanpa prefiks NNNN_:"; echo "$bad"; exit 1
fi

dups=$(echo "$names" | cut -c1-4 | uniq -d)
if [ -n "$dups" ]; then
  echo "::error::Nomor migrasi duplikat: $(echo "$dups" | tr '\n' ' ')"
  echo "$names"; exit 1
fi

# Cek 3 hanya di PR (GITHUB_BASE_REF terisi oleh event pull_request).
if [ -n "${GITHUB_BASE_REF:-}" ]; then
  git fetch --quiet --depth=1 origin "$GITHUB_BASE_REF"
  base_names=$(git ls-tree --name-only "FETCH_HEAD:$MIG_DIR" 2>/dev/null | grep -E '^[0-9]{4}_' | sort || true)
  base_max=$(echo "$base_names" | tail -1)
  new_names=$(comm -13 <(echo "$base_names") <(echo "$names"))
  if [ -n "$base_max" ] && [ -n "$new_names" ]; then
    while IFS= read -r n; do
      if [[ "${n:0:4}" < "${base_max:0:4}" || "${n:0:4}" == "${base_max:0:4}" ]]; then
        echo "::error::Migrasi baru '$n' bernomor <= migrasi tertinggi di ${GITHUB_BASE_REF} ('$base_max')."
        echo "Rebase branch ini ke ${GITHUB_BASE_REF}, lalu beri nomor migrasi berikutnya."
        exit 1
      fi
    done <<< "$new_names"
  fi
fi

echo "OK: $(echo "$names" | wc -l | tr -d ' ') migrasi, tanpa duplikat/urutan salah."
