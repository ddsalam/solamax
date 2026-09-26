/**
 * Membaca angka yang DIKETIK tim keuangan — satu tempat untuk kelima formulir
 * (harga beli, mutasi kas, settlement EDC, biaya, saldo pembuka).
 *
 * 🔴 **Kelas yang ditutup (26 Sep 2026).** Formulir lama membuang tanda baca:
 *   · nominal: `replace(/[^\d]/g, "")` ⇒ `1.500.000,50` tersimpan **150.000.050**;
 *   · harga beli: titik dibuang ⇒ `19582.51` tersimpan **1.958.251**.
 * Seratus kali lipat, tanpa satu pun pesan — dan layar sesudahnya menampilkan
 * angka itu dengan rapi.
 *
 * ⛔ **ATURANNYA: yang ambigu DITOLAK dengan contoh, bukan ditebak.** Menebak
 * dengan benar 99 kali tidak berguna bila kali keseratus salah seratus kali
 * lipat. Pesan penolakan selalu menyebut cara mengetik yang benar.
 *
 * Konvensi Indonesia: titik = pemisah ribuan, koma = desimal.
 */

export type HasilAngka =
  | { keadaan: "kosong" }
  | { keadaan: "sah"; nilai: number }
  | { keadaan: "tolak"; pesan: string };

const bersihkan = (teks: string): string =>
  teks
    .replace(/\s+/g, "")
    // Minus boleh ditulis sebelum "Rp": `-Rp250.000` = `-250.000`.
    .replace(/^(-?)(?:rp\.?|idr)/i, "$1");

/**
 * Nominal RUPIAH bulat — kas, bank, EDC, biaya, saldo pembuka.
 *
 * Sah: `1500000` · `1.500.000` · `Rp 1.500.000` · (bila `bolehNegatif`) `-250.000`.
 * Ditolak: apa pun yang berakhir dengan sen (`1.500.000,50`, `1500000.5`),
 * pengelompokan ribuan yang tak rapi (`1.50.000`), dan huruf.
 */
export function bacaRupiah(teks: string, opsi: { bolehNegatif?: boolean } = {}): HasilAngka {
  let s = bersihkan(teks);
  if (s === "") return { keadaan: "kosong" };
  let negatif = false;
  if (s.startsWith("-")) {
    if (!opsi.bolehNegatif) {
      return { keadaan: "tolak", pesan: "Ketik tanpa tanda minus — arahnya ditentukan pilihan Jenis." };
    }
    negatif = true;
    s = s.slice(1);
  }
  // Sen NOL yang lazim ditulis di kuitansi — `1.500.000,-`, `,00`, `,0` —
  // tidak mengubah nilai, jadi diterima. Sen BUKAN nol tetap ditolak di bawah.
  s = s.replace(/,(?:-|0{1,2})$/, "");
  if (/[.,]\d{1,2}$/.test(s)) {
    return {
      keadaan: "tolak",
      pesan: "Nominal rupiah diketik bulat, tanpa sen. Contoh: 1500000 atau 1.500.000.",
    };
  }
  if (!/^\d+$/.test(s) && !/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return {
      keadaan: "tolak",
      pesan: "Ketik angka saja, titik hanya untuk ribuan. Contoh: 1500000 atau 1.500.000.",
    };
  }
  const nilai = Number(s.replace(/\./g, ""));
  if (!Number.isSafeInteger(nilai)) return { keadaan: "tolak", pesan: "Angka terlalu besar." };
  return { keadaan: "sah", nilai: negatif ? -nilai : nilai };
}

/**
 * Harga beli PER LITER — boleh desimal, desimalnya KOMA (maks. 4 angka).
 *
 * Sah: `19582,51` · `19.582,51` · `19582` · `19.582`.
 * Ditolak: `19582.51` — titik diikuti 1–2 angka di ujung hampir pasti desimal
 * gaya Inggris; membacanya sebagai ribuan menghasilkan 1.958.251.
 */
export function bacaHargaLiter(teks: string): HasilAngka {
  const s = bersihkan(teks);
  if (s === "") return { keadaan: "kosong" };
  if (/^\d+\.\d{1,2}$/.test(s)) {
    const saran = s.replace(".", ",");
    return { keadaan: "tolak", pesan: `Desimal pakai koma, bukan titik. Maksud Anda ${saran}?` };
  }
  const m = /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,4}))?$/.exec(s);
  if (!m) {
    return {
      keadaan: "tolak",
      pesan: "Format harga: 19582,51 atau 19.582,51 (koma untuk desimal, paling banyak 4 angka).",
    };
  }
  const nilai = Number(`${m[1]!.replace(/\./g, "")}.${m[2] ?? "0"}`);
  return { keadaan: "sah", nilai };
}

/** Teks pratinjau di bawah kolom — "Terbaca: Rp 1.500.000". */
export function teksTerbaca(h: HasilAngka, satuan: "rupiah" | "per_liter"): string | null {
  if (h.keadaan !== "sah") return null;
  const angka = h.nilai.toLocaleString("id-ID", {
    minimumFractionDigits: 0,
    maximumFractionDigits: satuan === "per_liter" ? 4 : 0,
  });
  return satuan === "per_liter" ? `Terbaca: Rp ${angka} per liter` : `Terbaca: Rp ${angka}`;
}
