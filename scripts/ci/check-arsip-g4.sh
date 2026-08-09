#!/usr/bin/env bash
# Keputusan gerbang G4 — DIPISAH dari workflow supaya bisa diuji DUA ARAH.
#
# ⚠️ KENAPA BERKAS INI ADA, dan bukan sekadar `run:` di dalam YAML.
# Versi pertama gerbang ini hidup di dalam workflow. Ia dibuktikan bisa MERAH,
# tapi TIDAK PERNAH dibuktikan bisa HIJAU — karena label pelepasnya
# (`arsip-siklus-kedua`) belum pernah dibuat di repo. Sebuah gerbang yang jalan
# keluarnya tak ada tak bisa dibedakan dari gerbang tanpa jalan keluar: orang
# berikutnya akan mengira ia rusak dan mencari cara melewatinya.
#
# Bentuk yang diperbaiki, bukan cuma kejadiannya:
#   1. Gerbang yang MENUNTUT label wajib MEMASTIKAN labelnya ADA, dan bila tidak,
#      pesan gagalnya menyebut cara membuatnya.
#   2. Logikanya keluar dari YAML jadi skrip yang CI DAN self-test sama-sama
#      panggil — sehingga "sudah dibuktikan hijau" adalah asersi atas kode yang
#      benar-benar berjalan di CI, bukan atas tiruannya.
#
# Keluarga yang sama dengan `/dev/tcp` di zsh (pemeriksa yang tak bisa hijau) dan
# workflow yang gagal parse (pemeriksa yang tak pernah berjalan). Tiga kali dalam
# dua hari — dan yang ketiga terjadi pada alat yang dibangun untuk kelas ini.
#
# MASUKAN (env):
#   BASE_REF   branch tujuan PR (mis. staging / main)
#   HEAD_REF   branch asal PR
#   BERUBAH    daftar berkas session-notes/ yang berubah, satu per baris ("" = tak ada)
#   LABELS     label PR, dipisah koma
#   LABEL_ADA  "true" bila label pelepas ADA di repo, selain itu dianggap tidak
#   LABEL      nama label pelepas (default: arsip-siklus-kedua)
#   REPO       nama repo untuk pesan `gh label create` (kosmetik)

set -euo pipefail

LABEL="${LABEL:-arsip-siklus-kedua}"
REPO="${REPO:-<owner>/<repo>}"

# ── PENGECUALIAN: PR PROMOSI (staging → main) ────────────────────────────────
#
# Keputusan owner 2026-08-09. Siklus keduanya SUDAH terjadi di PR `staging`;
# menuntutnya lagi saat promosi adalah ritual duplikat — dan gerbang yang
# menuntut label yang sama setiap kali akan jadi stempel refleks dalam sepekan.
# Itu persis kematian yang diramalkan untuk alarm kas dorman, dan alasannya tidak
# berhenti berlaku hanya karena gerbang ini milik kami sendiri.
#
# ⚠️ SEMPIT DENGAN SENGAJA: `main` saja TIDAK cukup — head harus `staging`. Tanpa
# syarat kedua itu, siapa pun bisa melewati gerbang ini hanya dengan membuka PR
# langsung ke `main` dari branch fitur (yang memang sudah dilarang aturan repo,
# tapi pengecualian tak boleh bersandar pada aturan yang ditegakkan di tempat
# lain). Keadaan itu diuji tersendiri di self-test.
if [ "${BASE_REF:-}" = "main" ] && [ "${HEAD_REF:-}" = "staging" ]; then
  echo "PR promosi (staging → main) — G4 dikecualikan."
  echo "Siklus kedua sudah dinilai pada PR ke staging; menuntutnya lagi di sini"
  echo "hanya akan melatih orang memasang label secara refleks."
  exit 0
fi

if [ -z "${BERUBAH:-}" ]; then
  echo "PR ini tidak menyentuh session-notes/ — G4 tak berlaku."
  exit 0
fi

echo "Berkas arsip yang tersentuh:"
echo "$BERUBAH" | sed 's/^/  /'
echo

# ── Labelnya sendiri harus ADA. Tanpa ini gerbangnya tak punya jalan keluar. ──
if [ "${LABEL_ADA:-false}" != "true" ]; then
  echo "❌ G4 — label pelepas '$LABEL' TIDAK ADA di repo ini."
  echo
  echo "Gerbang ini menuntut sebuah label yang belum pernah dibuat, jadi ia tak"
  echo "punya jalan keluar sama sekali. Itu cacat gerbangnya, bukan cacat PR-mu."
  echo
  echo "BUATLAH DULU:"
  echo "  gh label create $LABEL --repo $REPO \\"
  echo "    --color 0E8A16 --description 'Temuan arsip sudah melewati tinjauan siklus kedua'"
  echo
  echo "lalu pasang label itu pada PR ini. Cek jalan ulang sendiri saat label"
  echo "terpasang — tak perlu push."
  exit 1
fi

case ",${LABELS:-}," in
  *,"$LABEL",*)
    echo "Label '$LABEL' terpasang — G4 dinyatakan terpenuhi oleh owner."
    echo "Catatan: label ini MENYATAKAN, bukan MEMBUKTIKAN. Ia memaksa keputusan"
    echo "keluar dan meninggalkan jejak; ia tidak menguji temuannya."
    exit 0
    ;;
esac

echo "❌ G4 — temuan arsip belum dinyatakan bertahan satu putaran."
echo
echo "PR ini menambah/mengubah berkas di session-notes/, dan G4 melarang"
echo "me-merge temuan pada siklus yang sama ia diasersikan."
echo
echo "PERBAIKANNYA (owner): pasang label '$LABEL' pada PR ini setelah temuannya"
echo "bertahan satu putaran. Cek ini jalan ulang sendiri begitu label terpasang —"
echo "tak perlu push."
echo
echo "Kalau isinya BUKAN temuan baru (mis. memindahkan berkas, memperbaiki"
echo "tautan, atau mencatat keputusan yang sudah diverifikasi), label yang sama"
echo "tetap cara menyatakannya — tulis alasannya di badan PR supaya jejaknya"
echo "bisa dibaca kemudian."
exit 1
