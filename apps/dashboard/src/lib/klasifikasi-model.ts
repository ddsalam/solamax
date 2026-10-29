import { KATEGORI_PENAMPUNG, PETA_KATEGORI_ARUS_KAS } from "./keuangan-sisi-kas";
import { kategoriPihakLawan, periksaPihakLawanMutasi, rpSen } from "./pihak-lawan-model";

/**
 * KLASIFIKASI MUTASI BANK — bagian MURNI (rencana 2026-10-29 U11; R9, R21,
 * R23, R27; KTD6, KTD8). Tanpa I/O; dipakai server action, halaman, dan uji.
 *
 * ⛔ TEMUAN YANG MENGIKAT (U6, dibuktikan ulang di sini): baris kas
 * berkategori beban/pendapatan TIDAK menggeser laba. Laba hanya membaca
 * `manual_entry` (pengeluaran / pendapatan_lain) dan `noncash_expense`; baris
 * kas "Biaya Operasional", "Management Fee", "Pendapatan Lain-Lain" adalah
 * REALISASI tunainya (`dariBukuKas: false` di {@link PETA_KATEGORI_ARUS_KAS}).
 * Maka klasifikasi ke kategori itu WAJIB melahirkan juga `manual_entry` pintu
 * Finance (§2.4) — {@link sectionBeban} menentukan kapan, dari peta yang SAMA
 * dengan arus kas, bukan dari daftar label kedua.
 */

/** 14 kategori operasional (§2.4, `List!K`) — satu daftar untuk kedua pintu. */
export const KATEGORI_OPERASIONAL = [
  "Iklan, Promosi, Spanduk",
  "Transportasi / Kendaraan Milik Perusahaan",
  "Supir Tangki",
  "Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun)",
  "Sumbangan / Donasi",
  "Komputer dan Internet",
  "Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)",
  "Konsumsi Makanan, Lembur, & Hiburan",
  "Peralatan Kantor (ATK)",
  "Biaya Taktis",
  "Gaji Karyawan",
  "Lain-Lain",
  "MDR",
  "Biaya Admin",
] as const;

export type SectionBeban = "pengeluaran" | "pendapatan_lain";

/**
 * Seksi `manual_entry` yang HARUS lahir bersama baris kas berkategori ini, atau
 * `null` bila kategori itu bukan realisasi laba (hutang piutang, penampung,
 * pindah buku, setoran, penebusan, …). Diturunkan dari peta arus kas: baris arus
 * "Biaya operasional"/"Pendapatan lain-lain" yang TIDAK dijumlah dari buku kas.
 */
export function sectionBeban(label: string | null | undefined): SectionBeban | null {
  const p = label ? PETA_KATEGORI_ARUS_KAS[label] : undefined;
  if (!p || p.dariBukuKas) return null;
  if (p.baris === "Biaya operasional") return "pengeluaran";
  if (p.baris === "Pendapatan lain-lain") return "pendapatan_lain";
  return null;
}

/** Satu baris kas yang akan dilahirkan klasifikasi. Nominal BERTANDA, sen bulat. */
export interface BarisKlasifikasi {
  amountSen: number;
  categoryLabel: string;
  pihakLawanId: string | null;
  /** Wajib bila {@link sectionBeban} kategori ≠ null; dilarang selainnya. */
  operationalCategory: string | null;
  keterangan: string;
}

/**
 * Vonis baris klasifikasi SEBELUM koneksi (pesan menyebut perbaikannya). Tanda
 * & sisi kategori mengikuti nominal; kategori/sisi yang benar-benar ada
 * diperiksa ulang di transaksi (FK 0029).
 */
export function periksaBarisKlasifikasi(baris: readonly BarisKlasifikasi[], opsi: { bolehPenampung?: boolean } = {}): string | null {
  if (baris.length === 0) return "Tak ada baris klasifikasi.";
  for (const [i, b] of baris.entries()) {
    const n = baris.length > 1 ? `Baris ${i + 1}: ` : "";
    if (!Number.isSafeInteger(b.amountSen) || b.amountSen === 0) return `${n}nominal tak valid.`;
    if (!b.categoryLabel || b.categoryLabel.trim() === "") return `${n}pilih kategorinya.`;
    if (b.categoryLabel === KATEGORI_PENAMPUNG && !opsi.bolehPenampung) {
      return `${n}“${KATEGORI_PENAMPUNG}” dipilih lewat Parkir, bukan sebagai kategori.`;
    }
    if (b.keterangan.trim() === "") return `${n}keterangan wajib diisi.`;
    if (b.pihakLawanId === null || !kategoriPihakLawan(b.categoryLabel)) {
      const salah = periksaPihakLawanMutasi({ categoryLabel: b.categoryLabel, pihakLawanId: b.pihakLawanId, pihak: null });
      if (salah !== null) return `${n}${salah}`;
    }
    const seksi = sectionBeban(b.categoryLabel);
    if (seksi === null && b.operationalCategory !== null) {
      return `${n}kategori operasional hanya untuk beban atau pendapatan lain-lain — kosongkan pilihannya.`;
    }
    if (seksi !== null) {
      if (b.operationalCategory === null || !(KATEGORI_OPERASIONAL as readonly string[]).includes(b.operationalCategory)) {
        return (
          `${n}“${b.categoryLabel}” ${seksi === "pengeluaran" ? "adalah beban" : "adalah pendapatan lain-lain"} — ` +
          `pilih kategori operasionalnya supaya laba hari bukunya ikut tercatat.`
        );
      }
    }
  }
  return null;
}

/** Jenis/sisi kas dari tanda nominal (debet > 0, kredit < 0 — 0029). */
export const jenisDariSen = (sen: number): "debet" | "kredit" => (sen > 0 ? "debet" : "kredit");

/** Σ baris = nominal baris impor, tepat Rp 0 (KTD6). */
export function periksaJumlah(baris: readonly { amountSen: number }[], targetSen: number): string | null {
  const j = baris.reduce((s, b) => s + b.amountSen, 0);
  if (j === targetSen) return null;
  return (
    `Jumlah baris ${j < 0 ? "−" : ""}${rpSen(j)} tidak sama dengan nominal mutasi ${targetSen < 0 ? "−" : ""}${rpSen(targetSen)} — ` +
    `selisih ${rpSen(j - targetSen)}. Kelompok cocok harus tepat Rp 0.`
  );
}

// ---------------------------------------------------------------------------
// Status baris impor di layar klasifikasi
// ---------------------------------------------------------------------------

export type StatusBarisImpor = "terbuka" | "tercocokkan" | "diparkir" | "pra-cut-over";

export const LABEL_STATUS_IMPOR: Record<StatusBarisImpor, string> = {
  terbuka: "Terbuka",
  tercocokkan: "Tercocokkan",
  diparkir: "Diparkir",
  "pra-cut-over": "Pra-cut-over",
};

/**
 * Status satu baris impor. "Diparkir" = kelompok aktifnya masih menyisakan
 * saldo penampung (Σ baris kas penampung di kelompok ≠ 0, KTD8): pemindahan
 * menambah pembalik −X di penampung, jadi Σ penampung kembali 0.
 */
export function statusBarisImpor(m: { praCutover: boolean; dicocokkan: boolean; penampungSen: number }): StatusBarisImpor {
  if (m.praCutover) return "pra-cut-over";
  if (!m.dicocokkan) return "terbuka";
  return m.penampungSen !== 0 ? "diparkir" : "tercocokkan";
}

/** Keterangan baris kas yang lahir dari baris impor — keterangan bank, dipangkas. */
export function keteranganDariBank(keteranganBank: string, ganti?: string | null): string {
  const g = (ganti ?? "").trim();
  if (g !== "") return g;
  const k = keteranganBank.replace(/\s+/g, " ").trim();
  return k === "" ? "Mutasi rekening koran" : k.slice(0, 200);
}
