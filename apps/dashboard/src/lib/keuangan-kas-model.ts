import { saldoAkun, type MutasiKas } from "./keuangan-kas";
import { KATEGORI_OPERASIONAL, sectionBeban, type SectionBeban } from "./klasifikasi-model";
import { rupiahKeSen } from "./pihak-lawan-model";

/**
 * Model tampilan blok 2 Layar 3 — "Buku kas besar & lima buku bank".
 *
 * MURNI (tanpa I/O). Aturannya tinggal di `keuangan-kas.ts`; berkas ini hanya
 * merangkai hasilnya jadi baris tabel dan daftar tawaran.
 *
 * ⛔ **SALDO DIHITUNG, TIDAK PERNAH DIKETIK DAN TIDAK PERNAH DISIMPAN.** Kolom
 * "Saldo" pada tabel adalah saldo BERJALAN yang dijumlahkan di sini setiap kali
 * halaman dirender. Workbook menyimpannya per baris, dan itulah sebabnya satu
 * sisipan di tengah mendiamkan seluruh kolom di bawahnya — angka lama tetap
 * terlihat benar sampai ada yang menjumlah ulang.
 */

export interface AkunKas {
  id: string;
  nama: string;
  kind: "kas" | "bank" | "edc_penampungan";
  active: boolean;
}

/** Satu baris buku, sudah membawa saldo berjalannya. */
export interface BarisBuku extends MutasiKas {
  id: string;
  keterangan: string;
  /** Saldo SETELAH baris ini — turunan, bukan kolom tabel. */
  saldoBerjalan: number;
  /** Baris ini lahir dari setoran pengawas yang disetujui (0033). */
  dariSetoranPengawas: boolean;
  /**
   * Baris SISTEM yang tidak boleh dibatalkan dari buku: saldo pembuka (§10.24,
   * milik Head of Finance) dan kaki pencairan EDC (tiga kaki satu jurnal —
   * membatalkan satu membuat buku tak seimbang), baris kas milik penebusan, dan
   * kaki pasangan antar unit (R31 — dibalik KEDUA kakinya, tak pernah satu).
   * `null` = baris biasa.
   */
  barisSistem: BarisSistem | null;
  /** Batch settlement yang melahirkan kaki pencairan ini — sasaran "Batalkan pencairan". */
  edcSettlementId?: string | null;
  /** 0062 — kunci transfer Kas Besar → bank dua kaki; sasaran "Batalkan transfer". */
  transferUuid?: string | null;
}

export type BarisSistem = "saldo_awal" | "pencairan_edc" | "penebusan" | "antar_unit" | "transfer";

export const PENJELASAN_BARIS_SISTEM: Record<BarisSistem, string> = {
  saldo_awal: "Saldo pembuka — hanya Head of Finance yang menggantinya, di Kelola akun kas.",
  pencairan_edc:
    "Bagian dari jurnal pencairan EDC (tiga baris sekaligus). Batalkan ketiganya bersamaan dengan " +
    "\"Batalkan pencairan\" — membatalkan satu baris saja membuat buku tidak seimbang.",
  penebusan:
    "Baris kas milik penebusan SO (rencana U7). Batalkan dari halaman Penebusan — membatalkannya di sini " +
    "membuat penebusan menunjuk baris kas yang tak ada.",
  antar_unit:
    "Kaki pinjaman antar unit (satu pasangan, dua buku). Membatalkan satu kaki membuat saldo kedua unit " +
    "berselisih — minta Head of Finance memakai \"Balik pasangan\" di halaman Pihak lawan › Pinjaman antar unit.",
  transfer: "Satu kaki transfer Kas Besar ↔ bank. Batalkan lewat 'Batalkan transfer' — kedua kaki batal bersama.",
};

/** Satu pembuat vonis untuk "baris ini baris sistem?" — dipakai layar DAN server. */
export function barisSistemDari(m: {
  saldoAwal: boolean;
  dariPencairanEdc?: boolean;
  dariPenebusan?: boolean;
  /** `pasangan_uuid IS NOT NULL` — kaki asli ATAU pembalik (maju) sebuah pasangan antar unit. */
  antarUnit?: boolean;
  /** `transfer_uuid IS NOT NULL` (0062) — kaki transfer Kas Besar → bank: dibatalkan berdua (KTD6). */
  transfer?: boolean;
}): BarisSistem | null {
  if (m.saldoAwal) return "saldo_awal";
  if (m.dariPencairanEdc) return "pencairan_edc";
  if (m.dariPenebusan) return "penebusan";
  if (m.antarUnit) return "antar_unit";
  if (m.transfer) return "transfer";
  return null;
}

/**
 * Baris satu akun pada satu tanggal, berurut waktu, dengan saldo berjalan.
 *
 * Saldo dimulai dari saldo akun pada H−1 — bukan nol. Buku yang memulai tiap
 * hari dari nol akan terlihat rapi dan salah.
 */
export function barisBuku(
  mutasi: readonly (MutasiKas & {
    id: string;
    keterangan: string;
    sourceManualEntryId?: string | null;
    dariPencairanEdc?: boolean;
    edcSettlementId?: string | null;
    antarUnit?: boolean;
    transferUuid?: string | null;
  })[],
  accountId: string,
  date: string,
  hariSebelumnya: string,
): BarisBuku[] {
  let saldo = saldoAkun(mutasi, accountId, hariSebelumnya);
  const out: BarisBuku[] = [];
  for (const m of mutasi) {
    if (m.void || m.accountId !== accountId || m.businessDate !== date) continue;
    saldo += m.amount;
    out.push({
      ...m,
      saldoBerjalan: saldo,
      dariSetoranPengawas: !!m.sourceManualEntryId,
      barisSistem: barisSistemDari({ ...m, transfer: m.transferUuid != null }),
    });
  }
  return out;
}

/** Ringkasan kaki tabel: jumlah mutasi hari itu + saldo akhir. */
export interface KakiBuku {
  nMutasi: number;
  totalMutasi: number;
  saldoAkhir: number;
}

/**
 * ⛔ `saldoAkhir` diambil dari **saldo berjalan baris terakhir**, bukan dihitung
 * ulang sebagai `saldoAwal + Σ`. Keduanya seharusnya sama — dan justru itu
 * masalahnya: dua jalan menuju satu angka berarti ada kemungkinan keduanya
 * berselisih, dan yang berselisih di sini adalah saldo akhir buku kas.
 *
 * (Ditemukan oleh tesnya sendiri: pemanggil yang mengirim `saldoAwal` berbeda
 * dari yang dipakai {@link barisBuku} menghasilkan dua angka sah yang tak
 * cocok. `saldoAwal` kini hanya dipakai saat hari itu KOSONG.)
 */
export function kakiBuku(baris: readonly BarisBuku[], saldoAwal: number): KakiBuku {
  const total = baris.reduce((s, b) => s + b.amount, 0);
  return {
    nMutasi: baris.length,
    totalMutasi: total,
    saldoAkhir: baris.at(-1)?.saldoBerjalan ?? saldoAwal,
  };
}

// ---------------------------------------------------------------------------
// Tawaran setoran — DITAWARKAN, bukan diposting (§1.4)
// ---------------------------------------------------------------------------

/** Setoran yang diisi pengawas di Rincian Penjualan (`manual_entry`). */
export interface SetoranPengawas {
  id: string;
  keterangan: string;
  amount: number;
}

export interface TawaranSetoran extends SetoranPengawas {
  /** Sudah pernah disetujui & masuk buku kas? */
  sudahDibukukan: boolean;
}

/**
 * Gabungkan setoran pengawas dengan status "sudah dibukukan atau belum".
 *
 * ⛔ Pencocokannya lewat **id setoran** (`source_manual_entry_id`, 0033), BUKAN
 * lewat nominal+tanggal. Dua shift dengan nominal kebetulan sama adalah kejadian
 * biasa, dan pencocokan berbasis nominal akan menganggap yang kedua sudah
 * dibukukan — setoran hilang, kas terlihat lebih kecil, tanpa satu pun angka
 * tampak salah.
 */
export function tawaranSetoran(
  setoran: readonly SetoranPengawas[],
  sudahDipakai: ReadonlySet<string>,
): TawaranSetoran[] {
  return setoran.map((s) => ({ ...s, sudahDibukukan: sudahDipakai.has(s.id) }));
}

/** Yang masih menunggu persetujuan. */
export function tawaranTertunda(t: readonly TawaranSetoran[]): TawaranSetoran[] {
  return t.filter((x) => !x.sudahDibukukan);
}

/**
 * Nilai total yang akan masuk buku bila SELURUH tawaran tertunda disetujui.
 * Dipakai untuk kalimat "N setoran senilai Rp X menunggu persetujuan" — angka
 * yang membuat tawaran yang terlupakan bisa terlihat, bukan cuma terdaftar.
 */
export function nilaiTertunda(t: readonly TawaranSetoran[]): number {
  return tawaranTertunda(t).reduce((s, x) => s + x.amount, 0);
}

// ---------------------------------------------------------------------------
// K6 U3 — biaya & pendapatan lain-lain dari Tambah mutasi (R23, R24, P11, P12, P20)
// ---------------------------------------------------------------------------

/**
 * Tiga kategori kas yang laba-nya hidup di `manual_entry`, bukan di buku kas
 * (temuan U6/U11, 0053). Satu simpan di buku kas/bank menulis mutasi DAN baris
 * Biaya/Pendapatan pintu Finance yang bertaut `cash_ledger_id`.
 *
 * Kunci peta ini wajib SAMA dengan label yang `sectionBeban` (peta arus kas)
 * anggap realisasi laba — dijaga uji, supaya tak ada label keempat yang lolos
 * tanpa barisnya.
 */
export type KategoriBeban = "biaya_operasional" | "pendapatan_lain" | "management_fee";

export const KATEGORI_BEBAN: Readonly<Record<string, KategoriBeban>> = {
  "Biaya Operasional": "biaya_operasional",
  "Pendapatan Lain-Lain": "pendapatan_lain",
  "Management Fee": "management_fee",
};

/**
 * Kategori operasional baris Biaya untuk dua kategori TANPA field kedua.
 * Pos-nya tetap ditentukan `tulisBebanFinance`: seksi `pendapatan_lain` selalu
 * 4200 (P12, `akunPintuFinance`); Management Fee lewat peta (P20 — "pos yang
 * HoF tetapkan, awal 5700"): kategori "Management Fee" bila HoF sudah memberinya
 * baris peta, selain itu "Lain-Lain" (peta 0056 → 5700).
 */
export const KATEGORI_OP_PENDAPATAN_LAIN = "Lain-Lain";
export const KATEGORI_OP_MANAGEMENT_FEE = ["Management Fee", "Lain-Lain"] as const;

/** Predikat murni — dipakai form Tambah mutasi DAN server. `null` = kategori biasa. */
export function kategoriBeban(label: string | null | undefined): KategoriBeban | null {
  return label ? (KATEGORI_BEBAN[label] ?? null) : null;
}

/** Hanya "Biaya Operasional" yang membuka field kedua (jenis biaya). */
export const butuhKategoriOperasional = (label: string | null | undefined): boolean =>
  kategoriBeban(label) === "biaya_operasional";

export interface RencanaBeban {
  section: SectionBeban;
  /**
   * Calon kategori operasional, BERURUT — yang pertama berpeta dipakai
   * (Management Fee). Tak pernah kosong: NULL berarti "belum berkategori"
   * (0024) dan membuat pendapatan dibaca lewat tebakan keterangan titipan.
   */
  kategoriOperasional: readonly string[];
  /** Sen bulat POSITIF — SELALU dari nominal mutasi, tak pernah dari isian kedua. */
  amountSen: number;
}

/**
 * Vonis + rencana baris Biaya/Pendapatan untuk satu mutasi. Nominal Biaya
 * DITURUNKAN dari nominal mutasi (bertanda) — tak ada jalan memasukkan angka
 * kedua. `null` kategori = bukan urusan fungsi ini.
 */
export function rencanaBeban(m: {
  categoryLabel: string | null | undefined;
  operationalCategory: string | null | undefined;
  /** Nominal mutasi BERTANDA, rupiah (debet > 0, kredit < 0). */
  amount: number;
}): { ok: true; rencana: RencanaBeban } | { ok: false; error: string } {
  const k = kategoriBeban(m.categoryLabel);
  const label = m.categoryLabel ?? "";
  const section = sectionBeban(label);
  if (k === null || section === null) return { ok: false, error: `“${label || "—"}” bukan kategori biaya atau pendapatan lain-lain.` };
  const sen = rupiahKeSen(m.amount);
  if (sen === null || sen === 0) return { ok: false, error: "Nominal tak valid — angka rupiah bukan nol, paling banyak dua desimal." };
  if (section === "pendapatan_lain" ? sen < 0 : sen > 0) {
    return {
      ok: false,
      error:
        section === "pendapatan_lain"
          ? "Pendapatan Lain-Lain adalah kas MASUK — pilih jenis Debet."
          : `${label} adalah kas KELUAR — pilih jenis Kredit.`,
    };
  }
  const op = (m.operationalCategory ?? "").trim();
  if (k === "biaya_operasional") {
    if (!(KATEGORI_OPERASIONAL as readonly string[]).includes(op)) {
      return { ok: false, error: "Biaya Operasional wajib memilih jenis biaya (kategori operasional) — dari situlah posnya dipetakan." };
    }
    return { ok: true, rencana: { section, kategoriOperasional: [op], amountSen: Math.abs(sen) } };
  }
  if (op !== "") {
    return { ok: false, error: `“${label}” tidak memakai jenis biaya — posnya sudah ditetapkan. Kosongkan pilihan itu.` };
  }
  return {
    ok: true,
    rencana: {
      section,
      kategoriOperasional: k === "pendapatan_lain" ? [KATEGORI_OP_PENDAPATAN_LAIN] : KATEGORI_OP_MANAGEMENT_FEE,
      amountSen: Math.abs(sen),
    },
  };
}
