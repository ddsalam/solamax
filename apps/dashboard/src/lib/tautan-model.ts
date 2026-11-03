import { kategoriBeban } from "./keuangan-kas-model";
import { sectionBeban, type SectionBeban } from "./klasifikasi-model";
import { kategoriPenebusan } from "./penebusan-model";
import { rupiahKeSen } from "./pihak-lawan-model";

/**
 * DAFTAR "PERLU DITAUTKAN" (rencana K6 U3; R27) — bagian MURNI, tanpa I/O.
 *
 * Tiga jenis baris yang separuh-tercatat sejak cut-over:
 *   (a) mutasi biaya/pendapatan lain-lain di buku kas/bank TANPA baris Biaya
 *       aktif yang bertaut (`manual_entry.cash_ledger_id`, 0053);
 *   (b) baris Biaya pintu Finance TANPA mutasi (`cash_ledger_id` NULL);
 *   (c) mutasi bank "Pembelian BBM" TANPA penebusan aktif.
 *
 * ⛔ SISTEM TIDAK MENEBAK TAUTANNYA. {@link kandidatMutasi} hanya MENYARING
 * pilihan untuk (b); staf Keuangan yang memilih, dan tautannya diperiksa ulang
 * {@link periksaTautanBeban} di server — termasuk ketika kandidatnya tunggal.
 */

/** Selisih hari kalender antara dua tanggal `YYYY-MM-DD` (UTC murni). */
export function selisihHari(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/** Jendela tanggal kandidat (b): sama ±3 hari. */
export const JENDELA_HARI = 3;

/** Baris kas calon daftar — sudah dibatasi sejak cut-over rekeningnya. */
export interface KasTautan {
  id: string;
  accountId: string;
  namaAkun: string;
  kindAkun: string;
  businessDate: string;
  keterangan: string;
  categoryLabel: string | null;
  /** BERTANDA, rupiah. */
  amount: number;
  void: boolean;
  bebanAktif: boolean;
  penebusanAktif: boolean;
  bulanTertutup: boolean;
}

/** Baris `manual_entry` (pengeluaran / pendapatan_lain). */
export interface BebanTautan {
  id: string;
  businessDate: string;
  section: SectionBeban;
  sourceDoor: string;
  keterangan: string;
  /** POSITIF (dinormalkan `NOMINAL_MANUAL_ENTRY_SQL`). */
  amount: number;
  operationalCategory: string | null;
  void: boolean;
  cashLedgerId: string | null;
  hariTertutup: boolean;
  bulanTertutup: boolean;
}

export interface PerluDitautkan {
  mutasiTanpaBiaya: KasTautan[];
  biayaTanpaMutasi: BebanTautan[];
  bbmTanpaPenebusan: KasTautan[];
}

/** Susun ketiga daftar. Baris bulan tertutup tetap tampil (tanpa tindakan). */
export function susunPerluDitautkan(kas: readonly KasTautan[], beban: readonly BebanTautan[]): PerluDitautkan {
  const hidup = kas.filter((k) => !k.void);
  return {
    mutasiTanpaBiaya: hidup.filter((k) => kategoriBeban(k.categoryLabel) !== null && !k.bebanAktif),
    biayaTanpaMutasi: beban.filter((b) => !b.void && b.sourceDoor === "finance" && b.cashLedgerId === null),
    bbmTanpaPenebusan: hidup.filter((k) => k.kindAkun === "bank" && kategoriPenebusan(k.categoryLabel) && !k.penebusanAktif),
  };
}

export const kosong = (p: PerluDitautkan): boolean =>
  p.mutasiTanpaBiaya.length + p.biayaTanpaMutasi.length + p.bbmTanpaPenebusan.length === 0;

/**
 * Vonis satu tautan (b): baris Biaya → baris kas. `null` = boleh. Diperiksa di
 * server atas baris yang dibaca ulang & dikunci; DB menegakkan dua hal yang
 * sama (CHECK `manual_entry_cash_ledger_finance`, unik parsial 0053).
 */
export function periksaTautanBeban(beban: BebanTautan, kas: KasTautan): string | null {
  if (beban.sourceDoor !== "finance") {
    return "Baris dari Rincian Penjualan (pengawas) tidak ditautkan ke buku kas — hanya baris pintu Finance.";
  }
  if (beban.void) return "Baris Biaya sudah dibatalkan.";
  if (beban.cashLedgerId !== null) return "Baris Biaya ini sudah bertaut ke mutasi lain.";
  if (kas.void) return "Mutasi sudah dibatalkan.";
  if (kas.bebanAktif) return "Mutasi ini sudah punya baris Biaya aktif — satu mutasi hanya untuk satu baris Biaya.";
  if (beban.bulanTertutup || kas.bulanTertutup) {
    return "Bulannya sudah ditutup — koreksinya lewat jurnal memorial Head of Finance, bukan tautan.";
  }
  if (beban.hariTertutup) {
    return `Hari buku baris Biaya (${beban.businessDate}) sudah tutup hari — barisnya terkunci dan tak bisa ditautkan.`;
  }
  if (sectionBeban(kas.categoryLabel) !== beban.section) {
    return beban.section === "pendapatan_lain"
      ? "Pendapatan lain-lain hanya ditautkan ke mutasi berkategori Pendapatan Lain-Lain."
      : "Biaya hanya ditautkan ke mutasi berkategori Biaya Operasional atau Management Fee.";
  }
  const senKas = rupiahKeSen(kas.amount);
  const senBeban = rupiahKeSen(beban.amount);
  if (senKas === null || senBeban === null || Math.abs(senKas) !== Math.abs(senBeban)) {
    return "Nominal mutasi dan baris Biaya harus sama persis.";
  }
  if (Math.abs(selisihHari(kas.businessDate, beban.businessDate)) > JENDELA_HARI) {
    return `Tanggal mutasi dan baris Biaya berselisih lebih dari ${JENDELA_HARI} hari.`;
  }
  return null;
}

/** Kandidat mutasi untuk satu baris Biaya (b) — disaring, tidak dipilihkan. */
export function kandidatMutasi(beban: BebanTautan, kas: readonly KasTautan[]): KasTautan[] {
  return kas
    .filter((k) => periksaTautanBeban(beban, k) === null)
    .sort(
      (x, y) =>
        Math.abs(selisihHari(x.businessDate, beban.businessDate)) - Math.abs(selisihHari(y.businessDate, beban.businessDate)) ||
        x.businessDate.localeCompare(y.businessDate),
    );
}
