#!/usr/bin/env bash
# Penjaga berkas CADANGAN yang ter-track.
#
# ⚠️ KEJADIAN NYATA (2026-08-09): `apps/dashboard/src/lib/compliance.ts.bak` —
# sisa uji mutasi — ter-`git add -A`, ter-commit, lolos review, dan TAYANG DI
# `main`. Ia yatim (tak ada yang mengimpornya) dan berisi salinan BASI logika
# vonis yang mendahului gerbang `hari_berjalan`. Yang membuatnya berbahaya bukan
# ukurannya, melainkan kemiripannya: `compliance.ts.bak` tepat di sebelah
# `compliance.ts`, dan pembaca berikutnya akan membaca aturan yang tak berlaku.
#
# DUA LAPIS, sengaja:
#   (a) `.gitignore` MENCEGAH `git add -A` menyapunya.
#   (b) penjaga ini MENANGKAP yang lolos pencegahan — termasuk `git add -f` dan
#       berkas yang sudah terlanjur ter-track sebelum polanya ditambahkan.
#
# ⛔ BATAS YANG DISEBUT: ia menjaga AKHIRAN, bukan KONSEP. Salinan yatim yang
# namanya wajar (`compliance-lama.ts`) TIDAK akan tertangkap. Bentuk "cari
# berkas yang tak diimpor siapa pun" DITOLAK secara sadar: rasio positif-palsunya
# (entri konvensi Next, re-export, berkas yang disiapkan lebih dulu) akan membuat
# orang mematikannya — dan gerbang mati lebih buruk dari tak ada gerbang, karena
# ia terlihat seperti perlindungan. Yang menangkap kelas itu tetap review.

set -euo pipefail
cd "$(dirname "$0")/../.."

# Akhiran artefak editor / merge / cadangan. Tak satu pun punya pemakaian sah.
POLA='\.(bak|orig|rej|swp|swo|save)$|~$|\.copy(\.[^.]+)?$'

# Sumber daftar berkas. Default `git ls-files`; `DAFTAR` menggantikannya HANYA
# untuk self-test. Seam ini ada supaya cabang anti-vakum di bawah BISA DIMERAHKAN
# — tanpanya ia cabang yang tak pernah bisa diuji, dan cabang begitu memberi rasa
# aman yang tak dibayar apa-apa (aturan yang sama sudah dipakai di compliance.ts).
SEMUA=${DAFTAR:-$(git ls-files)}
# KONTROL ANTI-VAKUM: `git ls-files` yang mengembalikan sedikit (mis. dijalankan
# di luar repo, atau sparse-checkout) akan "lulus" tanpa memeriksa apa pun —
# persis kegagalan yang penjaga ini ada untuk mencegah.
JUMLAH=$(printf '%s\n' "$SEMUA" | grep -c . || true)
if [ "$JUMLAH" -lt 100 ]; then
  echo "❌ hanya $JUMLAH berkas ter-track terbaca — penjaga ini tak bisa berbunyi, jadi ia GAGAL."
  exit 1
fi

TEMUAN=$(printf '%s\n' "$SEMUA" | grep -E "$POLA" || true)
if [ -n "$TEMUAN" ]; then
  echo "❌ Berkas CADANGAN ter-track ditemukan:"
  printf '%s\n' "$TEMUAN" | sed 's/^/  /'
  echo
  echo "Berkas begini adalah salinan BASI yang duduk di sebelah aslinya. Pembaca"
  echo "berikutnya akan membacanya sebagai kode yang berlaku."
  echo
  echo "PERBAIKANNYA:  git rm --cached <berkas>   (lalu hapus dari disk bila perlu)"
  echo
  echo "Kalau berkas itu memang harus ada dengan nama itu — hampir pasti tidak —"
  echo "ganti namanya jadi sesuatu yang menyatakan perannya, bukan asal-usulnya."
  exit 1
fi

echo "check-backup-files: $JUMLAH berkas ter-track, tak ada artefak cadangan."
