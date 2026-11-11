import type { EdcBelumDiposting, SelEdcBelumDiposting } from "./edc-shift-model";
import type { KelengkapanInput } from "./keuangan-input-queries";

/**
 * Kelengkapan input Layar 4 — kalimat yang dibaca Finance. MURNI (tanpa I/O).
 *
 * ⛔ PERINGATAN SAJA. Kelengkapan tidak pernah menahan tombol tutup hari —
 * yang menahan hanyalah `periksaTutupHari` (selisih, kode alasan, wewenang).
 * Butir baru di sini mengikuti aturan yang sama.
 */

const rp = (n: number): string => `Rp ${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

const KET_STATUS: Record<SelEdcBelumDiposting["status"], string> = {
  belum_dicek: "belum dicek pengawas",
  cocok: "ditahan, menunggu Finance",
  selisih: "selisih slip, menunggu Finance",
  berubah_sesudah_dicek: "EasyMax berubah, cek ulang",
};

/** `null` bila semua sel EDC hari itu sudah terposting (atau tak ada EDC). */
export function pesanEdcBelumDiposting(e: EdcBelumDiposting): string | null {
  if (e.sel.length === 0 && e.kartuTanpaPeta.length === 0) return null;
  const bagian = [
    ...e.sel.map((s) => `shift ${s.cshift} ${s.acquirer} ${rp(s.easymaxRp)} (${KET_STATUS[s.status]})`),
    ...e.kartuTanpaPeta.map((k) => `kartu ${k.ckdkartu} belum dipetakan ke bank ${rp(k.rp)}`),
  ];
  return `EDC per shift belum diposting — ${bagian.join(", ")}; total ${rp(e.totalRp)}`;
}

/** Daftar butir yang belum lengkap; panjangnya = angka "N belum". */
export function syaratKelengkapan(k: KelengkapanInput): string[] {
  const kurang: string[] = [];
  if (!k.hargaBeliLengkap) kurang.push(`${k.produkTanpaHarga} produk belum punya harga beli`);
  if (!k.adaAkunKas) kurang.push("belum ada akun kas");
  if (k.settlementBelumCair > 0) kurang.push(`${k.settlementBelumCair} settlement EDC belum disetujui`);
  if (k.biayaMenungguTinjauan > 0) kurang.push(`${k.biayaMenungguTinjauan} baris biaya menunggu tinjauan`);
  const edc = pesanEdcBelumDiposting(k.edcBelumDiposting);
  if (edc !== null) kurang.push(edc);
  return kurang;
}
