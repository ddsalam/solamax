#!/usr/bin/env bash
# Helper UJI MUTASI — satu-satunya bentuk yang boleh dipakai di repo ini.
#
# ⛔ MASALAH YANG DITUTUPNYA. Uji mutasi membuktikan penjaga bisa MERAH; tetapi
# helper ad-hoc yang dipakai untuk menjalankannya GAGAL DUA KALI dalam satu arc,
# dengan dua sebab berbeda, dan keduanya membuat hasilnya tak bisa dipercaya:
#
#   1. Derivasi path cadangan salah  → berkas tak dipulihkan → mutasi MENUMPUK,
#      dan mutasi ke-2 dst diuji terhadap kode yang sudah rusak.
#   2. Berkas yang dimutasi TIDAK ADA di daftar cadangan yang dideklarasikan
#      lebih dulu → hal yang sama, sebab berbeda.
#
# Keduanya hanya tertangkap oleh baris `pulih:` yang tak masuk akal. Dua kali
# gagal pada alat ukur yang sama bukan kesialan — itu tanda alat itu perlu
# bentuk tetap DAN tesnya sendiri (lihat mutasi.selftest.sh).
#
# TIGA JAMINAN yang diberikan bentuk ini:
#   · cadangan dibuat SAAT ITU dari argumennya (mktemp), bukan dari daftar;
#   · MENEMPEL diverifikasi — mutasi yang tak mengubah berkas dilaporkan, bukan
#     dihitung sebagai bukti;
#   · PULIH diverifikasi — berkasnya wajib kembali identik, dan kalau tidak,
#     skripnya keluar dengan status bukan-nol alih-alih melanjutkan diam-diam.
#
# Pakai:
#   . scripts/mutasi.sh
#   mutasi_run() { pnpm exec vitest run <berkas> 2>&1 | grep -E "Tests +[0-9]" | tail -1; }
#   mutasi "label" <berkas> '<ekspresi perl -0pi -e>'

# Diisi pemanggil. Default sengaja gagal keras: helper tanpa perintah uji akan
# melaporkan "menempel" untuk segalanya dan tak menguji apa pun.
mutasi_run() { echo "⚠️ mutasi_run() belum didefinisikan"; return 1; }

mutasi() {
  local label="$1" berkas="$2" ekspr="$3"
  if [ ! -f "$berkas" ]; then
    echo "$label → ⚠️ BERKAS TIDAK ADA: $berkas"
    return 1
  fi
  local cadangan
  cadangan="$(mktemp)"
  cp "$berkas" "$cadangan"

  perl -0pi -e "$ekspr" "$berkas"

  local hasil=0
  if diff -q "$cadangan" "$berkas" >/dev/null; then
    # Mutasi yang tak mengubah apa pun bukan bukti. Hijaunya bukan kabar baik —
    # ia bukan kabar.
    echo "$label → ⚠️ TIDAK MENEMPEL (berkas tak berubah)"
    hasil=1
  else
    printf '%s → ' "$label"
    mutasi_run
  fi

  cp "$cadangan" "$berkas"
  if ! diff -q "$cadangan" "$berkas" >/dev/null; then
    echo "   ⛔ GAGAL PULIH: $berkas — hasil mutasi SESUDAH ini tak bisa dipercaya"
    rm -f "$cadangan"
    return 2
  fi
  rm -f "$cadangan"
  return $hasil
}
