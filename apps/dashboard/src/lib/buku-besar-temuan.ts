import type { KodeTemuan, Temuan } from "./buku-besar-model";

/**
 * Temuan PEMBENTUKAN jurnal (rencana 2026-11-02 K6; R27, R11) — hal yang
 * membuat jurnal tidak dibuat atau dibuat ke pos kliring (1198/1103), seperti
 * yang dihitung "Bentuk ulang" ("31 hari, 17 temuan"). BEDA dengan tab "Temuan
 * beda" (selisih laporan rumus vs buku besar).
 *
 * Sumbernya catatan audit pembentukan terakhir setiap hari
 * (`buku_besar.bentuk_ulang`, ditulis Bentuk ulang, tutup hari, tutup bulan):
 * cepat dibaca dan sama persis dengan angka yang dilaporkan tombolnya. Catatan
 * lama hanya membawa kode; rinciannya ada sesudah pembentukan berikutnya.
 * Modul MURNI.
 */

/** Batas rincian per hari di catatan audit (pesan + id) — angka kodenya tetap utuh. */
export const MAKS_RINCIAN_TEMUAN = 200;

export const LABEL_TEMUAN: Record<KodeTemuan, string> = {
  belum_tertaut: "Belum ditautkan (masuk 1198)",
  tautan_tak_seimbang: "Tautan tidak sama dengan nominal mutasi",
  kategori_kosong: "Mutasi tanpa kategori",
  kategori_tak_dikenal: "Kategori belum punya aturan posting",
  pos_kategori_kosong: "Baris Biaya tanpa pos",
  pos_akun_tak_dikenal: "Rekening tanpa sub-pos",
  pencairan_tak_seimbang: "Pencairan EDC tidak menutup",
  sisa_1103_belum_disetujui: "Sisa Penjualan Belum Disetor belum disetujui",
  harga_beli_kosong: "Harga beli belum diisi (HPP tidak diposting)",
  harga_jual_kosong: "Harga jual tidak diketahui",
  losses_gain_kosong: "Losses/gain tak terhitung",
  stok_kosong: "Stok tidak diketahui",
  saldo_awal_persediaan_kosong: "Saldo awal 1131/1132 belum diisi",
};

/** Ke mana memperbaikinya. */
export type TujuanTemuan = "input" | "laporan" | "tutup-hari" | "saldo-awal";

const TUJUAN: Record<KodeTemuan, TujuanTemuan> = {
  belum_tertaut: "input",
  tautan_tak_seimbang: "input",
  kategori_kosong: "input",
  kategori_tak_dikenal: "input",
  pos_kategori_kosong: "input",
  pos_akun_tak_dikenal: "input",
  pencairan_tak_seimbang: "input",
  harga_beli_kosong: "input",
  sisa_1103_belum_disetujui: "tutup-hari",
  harga_jual_kosong: "laporan",
  losses_gain_kosong: "laporan",
  stok_kosong: "laporan",
  saldo_awal_persediaan_kosong: "saldo-awal",
};

export function tautanTemuan(code: string, bulan: string, tanggal: string, kode: KodeTemuan): { href: string; label: string } {
  switch (TUJUAN[kode] ?? "input") {
    case "laporan":
      return { href: `/keuangan/unit/${code}/${tanggal}`, label: "laporan harian" };
    case "tutup-hari":
      return { href: `/keuangan/unit/${code}/tutup-hari/${tanggal}`, label: "tutup hari" };
    case "saldo-awal":
      return { href: `/keuangan/unit/${code}/buku-besar/${bulan}?tab=saldo-awal`, label: "saldo awal" };
    default:
      return { href: `/keuangan/unit/${code}/${tanggal}/input`, label: "input harian" };
  }
}

/** Satu baris catatan audit pembentukan terakhir per hari. */
export interface CatatanPembentukan {
  tanggal: string;
  dibentukAt: string;
  kode: string[];
  rincian: Temuan[] | null;
}

export interface BarisTemuanPembentukan {
  tanggal: string;
  kode: KodeTemuan;
  label: string;
  /** null = catatan lama tanpa rincian. */
  pesan: string | null;
  sumberId: string | null;
}

export interface TemuanPembentukan {
  baris: BarisTemuanPembentukan[];
  /** Jumlah per kode, urut terbanyak dulu. */
  ringkas: { kode: KodeTemuan; label: string; n: number }[];
  /** Hari yang catatannya belum membawa rincian. */
  hariTanpaRincian: string[];
  total: number;
}

const kenal = (k: string): k is KodeTemuan => k in LABEL_TEMUAN;

export function susunTemuanPembentukan(catatan: readonly CatatanPembentukan[]): TemuanPembentukan {
  const baris: BarisTemuanPembentukan[] = [];
  const hariTanpaRincian: string[] = [];
  for (const c of [...catatan].sort((a, b) => a.tanggal.localeCompare(b.tanggal))) {
    if (c.rincian !== null) {
      for (const t of c.rincian) {
        if (!kenal(t.kode)) continue;
        baris.push({ tanggal: c.tanggal, kode: t.kode, label: LABEL_TEMUAN[t.kode], pesan: t.pesan, sumberId: t.sumberId ?? null });
      }
      continue;
    }
    if (c.kode.length > 0) hariTanpaRincian.push(c.tanggal);
    for (const k of c.kode) if (kenal(k)) baris.push({ tanggal: c.tanggal, kode: k, label: LABEL_TEMUAN[k], pesan: null, sumberId: null });
  }
  const n = new Map<KodeTemuan, number>();
  for (const b of baris) n.set(b.kode, (n.get(b.kode) ?? 0) + 1);
  const ringkas = [...n].map(([kode, jumlah]) => ({ kode, label: LABEL_TEMUAN[kode], n: jumlah })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  return { baris, ringkas, hariTanpaRincian, total: baris.length };
}
