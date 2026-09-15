#!/usr/bin/env bash
# Penjaga: SETIAP berkas di .github/workflows/ harus bisa di-parse sebagai YAML
# dan punya trigger `on:` serta `jobs:`.
#
# ⚠️ KENAPA INI ADA (2026-08-09, dibayar hari ini juga). Workflow `arsip-g4.yml`
# ditambahkan dengan heredoc di dalam `run: |`. Terminator heredoc harus di
# kolom 0 — dan kolom 0 KELUAR dari block scalar YAML, jadi seluruh berkas tak
# bisa di-parse. GitHub menjalankannya sebagai run terpisah yang gagal 0 detik.
#
# Yang membuatnya berbahaya: `gh pr checks` menunjukkan **semua hijau**. Run yang
# gagal itu tidak muncul di sana karena ia bukan check dari PR-nya. Gerbang baru
# yang saya pasang untuk menegakkan aturan ternyata TIDAK PERNAH BERJALAN, dan
# permukaan yang biasa saya percaya bilang semuanya beres.
#
# Bentuk yang berulang: instrumen yang lebih rapuh dari fenomenanya, dan
# pemeriksa yang tak bisa berbunyi. Penjaga ini berjalan di dalam CI biasa,
# sehingga kegagalannya muncul di tempat yang MEMANG dilihat orang.

set -euo pipefail
cd "$(dirname "$0")/../.."

DIR=.github/workflows
n=0

for f in "$DIR"/*.yml "$DIR"/*.yaml; do
  [ -e "$f" ] || continue
  n=$((n + 1))
  python3 - "$f" <<'PY'
import sys
try:
    import yaml
except ModuleNotFoundError:
    sys.exit("check-workflows: PyYAML tak tersedia — penjaga ini tak bisa berbunyi, "
             "jadi ia GAGAL alih-alih diam. Pasang PyYAML di runner.")

p = sys.argv[1]
try:
    with open(p, encoding="utf-8") as fh:
        d = yaml.safe_load(fh)
except yaml.YAMLError as e:
    sys.exit(f"❌ {p}: YAML tak bisa di-parse — GitHub akan menolak workflow ini "
             f"TANPA muncul di `gh pr checks`.\n{e}")

if not isinstance(d, dict):
    sys.exit(f"❌ {p}: isi bukan mapping YAML.")

# PyYAML membaca `on:` sebagai boolean True (YAML 1.1) — keduanya diterima.
if "on" not in d and True not in d:
    sys.exit(f"❌ {p}: tak ada trigger `on:`.")
if "jobs" not in d or not d["jobs"]:
    sys.exit(f"❌ {p}: tak ada `jobs:`.")
print(f"  ok  {p}")
PY
done

# ── Setiap skrip yang DIRUJUK workflow harus ADA ────────────────────────────
#
# ⚠️ Dibayar 14-09-2026: promosi ke `main` tertahan `deploy-test exit 127`
# karena `deploy-backend.yml` masih memanggil `scripts/ci/check-temporary-retire-job.sh`
# sesudah skrip itu dikonsolidasikan (di-rename) menjadi
# `check-snapshot-scheduler-jobs.sh`. YAML-nya sah, jobnya terdaftar, dan
# penjaga di atas HIJAU — karena ia hanya memeriksa bentuk, bukan rujukan.
#
# Kelasnya: saat mengonsolidasikan skrip, pemanggilnya tidak ikut tersisir.
# `exit 127` baru terlihat saat deploy berjalan, yaitu saat paling mahal.
rujukan=0
hilang=0
while IFS= read -r ref; do
  rujukan=$((rujukan + 1))
  if [ ! -f "$ref" ]; then
    echo "❌ $ref dirujuk workflow/action tetapi TIDAK ADA — ini exit 127 saat deploy."
    hilang=$((hilang + 1))
  fi
done < <(grep -rhoE 'scripts/(ci|piutang-[a-z0-9]+)/[A-Za-z0-9_.-]+\.(sh|py|sql)' \
           .github/workflows/ .github/actions/ 2>/dev/null | sort -u)

[ "$hilang" -eq 0 ] || exit 1

# KONTROL ANTI-VAKUM: direktori kosong / glob yang tak cocok akan "lulus" tanpa
# memeriksa apa pun — persis kegagalan yang penjaga ini ada untuk mencegah.
# Berlaku untuk KEDUA pemeriksaan: nol rujukan juga berarti regex-nya berhenti
# cocok, bukan berarti tidak ada skrip yang dipanggil.
if [ "$n" -lt 3 ]; then
  echo "❌ hanya $n workflow terbaca di $DIR — glob-nya kemungkinan tak cocok."
  exit 1
fi
if [ "$rujukan" -lt 3 ]; then
  echo "❌ hanya $rujukan rujukan skrip terbaca — regex-nya kemungkinan tak cocok."
  exit 1
fi

echo "check-workflows: $n workflow valid, $rujukan rujukan skrip semuanya ada."
