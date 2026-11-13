import {
  tagihanJatuhTempoLabel,
  tagihanStatusBayarLabel,
  tagihanSumberJatuhTempoLabel,
} from "@/lib/tagihan-model";
import type { BelumDitagihkanDokumen, PeriodeTagihan, TagihanBaris } from "@/lib/tagihan-queries";
import { susunCsv } from "./csv";
import { safeSpreadsheetText } from "./piutang";

/**
 * CSV layar Tagihan pelanggan (rencana 2026-11-13 U7; R8). Isinya SAMA dengan
 * saringan aktif di layar: satu baris data per baris yang diserahkan, dalam
 * urutan yang sama — tanpa halaman, tanpa penyaringan ulang di sini.
 *
 * Aturan CSV repo berlaku (`csv.ts`, `teks-kosong.ts`): angka tanpa pemisah
 * ribuan, tidak ada sel kosong untuk nilai yang tak ada, dan teks dari EasyMax
 * dinetralkan sebelum dikutip.
 */

/** Sel untuk nilai yang tidak ada — tidak pernah string kosong (Excel membacanya nol). */
export const TAGIHAN_CSV_KOSONG = "—";

export const TAGIHAN_CSV_KOLOM_FAKTUR = [
  "Kode unit", "Nama unit", "Kode pelanggan", "Nama pelanggan", "No. faktur", "Tanggal faktur",
  "Jatuh tempo", "Sumber jatuh tempo", "Nilai", "Dibayar", "Sisa", "Status bayar", "Status jatuh tempo",
  "Hari lewat", "Pembayaran terakhir", "Beda status dengan EasyMax", "Beda sisa dengan EasyMax",
  "Jatuh tempo EasyMax tak wajar", "Jatuh tempo EasyMax", "Sisa EasyMax", "Keterangan",
] as const;

export const TAGIHAN_CSV_KOLOM_DOKUMEN = [
  "Kode unit", "Nama unit", "Kode pelanggan", "Nama pelanggan", "No. dokumen", "Tanggal", "Jumlah", "Keterangan",
] as const;

const angka = (value: number): string => String(Math.round(value) || 0);
const yaTidak = (value: boolean): string => (value ? "ya" : "tidak");
const teks = (value: string | null | undefined): string => {
  const isi = value?.trim() ?? "";
  return isi === "" ? TAGIHAN_CSV_KOSONG : safeSpreadsheetText(isi);
};

export interface TagihanCsvKepala {
  unit: { code: string; name: string };
  ptLabel: string;
  /** Label saringan aktif, mis. "Lewat jatuh tempo". */
  tampilanLabel: string;
  /** Pencarian pelanggan yang aktif; `""` = tanpa pencarian. */
  cari: string;
  /** Status dihitung terhadap tanggal ini (WIB). */
  hariIni: string;
  /** "Data EasyMax terakhir masuk …" (R22). */
  kesegaranLabel: string;
  generatedLabel: string;
  generatedBy: string;
  /** Batas baris terlampaui: berkas TIDAK lengkap dan harus mengatakannya. */
  terpotong: boolean;
}

function kepala(input: TagihanCsvKepala, tambahan: string[][]): string[][] {
  return [
    ["Laporan", "Tagihan pelanggan"],
    ["PT", teks(input.ptLabel)],
    ["Unit", teks(input.unit.name)],
    ["Kode unit", teks(input.unit.code)],
    ["Saringan", input.tampilanLabel],
    ["Pencarian pelanggan", input.cari ? safeSpreadsheetText(input.cari) : "tanpa pencarian"],
    ...tambahan,
    ["Status dihitung per", input.hariIni],
    ["Kesegaran data", teks(input.kesegaranLabel)],
    ["Dibuat", teks(input.generatedLabel)],
    ["Dicetak oleh", teks(input.generatedBy)],
    ["Kelengkapan", input.terpotong ? "TERPOTONG — batas baris terlampaui, berkas ini tidak lengkap" : "lengkap"],
  ];
}

/** Satu baris data per faktur, urutan apa adanya. Diekspor agar uji bisa membandingkannya dengan layar. */
export function barisFakturCsv(unit: { code: string; name: string }, b: TagihanBaris): string[] {
  const { faktur, status } = b;
  return [
    teks(unit.code),
    teks(unit.name),
    teks(faktur.customerCode),
    teks(b.namaPelanggan ?? "Nama belum tersedia"),
    teks(faktur.kode),
    b.tanggalFakturKosong ? TAGIHAN_CSV_KOSONG : faktur.tanggalFaktur,
    status.jatuhTempo ?? "belum diatur",
    tagihanSumberJatuhTempoLabel(status) ?? "termin belum diatur",
    angka(status.nilai),
    angka(status.dibayar),
    angka(status.sisa),
    tagihanStatusBayarLabel(status.statusBayar) ?? "Belum dibayar",
    tagihanJatuhTempoLabel(status) ?? TAGIHAN_CSV_KOSONG,
    String(status.hariLewat),
    b.tanggalBayarTerakhir ?? "belum ada pembayaran",
    yaTidak(status.bedaStatus),
    yaTidak(status.bedaSisa),
    yaTidak(status.jtEasymaxTakWajar),
    faktur.jatuhTempoEasymax ?? "tidak diisi",
    faktur.sisaEasymax === null ? "tidak diisi" : angka(faktur.sisaEasymax),
    teks(b.keterangan),
  ];
}

/** Ekspor saringan faktur (Perlu tindakan, Lewat jatuh tempo, Sebagian, Lebih bayar, Lunas). */
export function tagihanCsv(input: TagihanCsvKepala & {
  /** Hanya untuk saringan Lunas: periode tanggal pelunasan. */
  periodeLunas: PeriodeTagihan | null;
  baris: readonly TagihanBaris[];
}): string {
  return susunCsv([
    ...kepala(input, [
      ...(input.periodeLunas ? [["Periode pelunasan", `${input.periodeLunas.from} s.d. ${input.periodeLunas.to}`]] : []),
      ["Jumlah faktur", String(input.baris.length)],
      ["Total sisa", angka(input.baris.reduce((total, b) => total + b.status.sisa, 0))],
    ]),
    ["Catatan", "Status dihitung SolaMax dari pembayaran yang tidak batal, bukan dari flag status EasyMax. Sisa negatif berarti lebih bayar."],
    [],
    [...TAGIHAN_CSV_KOLOM_FAKTUR],
    ...input.baris.map((b) => barisFakturCsv(input.unit, b)),
  ]);
}

export function barisDokumenCsv(unit: { code: string; name: string }, d: BelumDitagihkanDokumen): string[] {
  return [
    teks(unit.code),
    teks(unit.name),
    teks(d.customerCode),
    teks(d.namaPelanggan ?? "Nama belum tersedia"),
    teks(d.kodeDokumen),
    d.tanggal ?? TAGIHAN_CSV_KOSONG,
    angka(d.jumlah),
    teks(d.keterangan),
  ];
}

/** Ekspor saringan "Belum ditagihkan": daftar dokumennya, tertua dulu. */
export function belumDitagihkanCsv(input: TagihanCsvKepala & {
  dokumen: readonly BelumDitagihkanDokumen[];
}): string {
  return susunCsv([
    ...kepala(input, [
      ["Jumlah dokumen", String(input.dokumen.length)],
      ["Total", angka(input.dokumen.reduce((total, d) => total + d.jumlah, 0))],
    ]),
    ["Catatan", "Penjualan kredit (posting debet buku piutang) yang belum masuk faktur hidup mana pun."],
    [],
    [...TAGIHAN_CSV_KOLOM_DOKUMEN],
    ...input.dokumen.map((d) => barisDokumenCsv(input.unit, d)),
  ]);
}
