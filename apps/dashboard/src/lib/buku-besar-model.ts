import { addDays } from "./periods";
import { tierFor, type Tier } from "./keuangan-tutup-hari";

/**
 * BUKU BESAR — aturan posting MURNI (rencana 2026-11-02 K6 U8; R6, R7, R11,
 * R13, KTD3, KTD4, KTD5, Tabel Aturan Posting P1–P28). Tanpa I/O.
 *
 * Catatan sumber yang SUDAH ADA (EasyMax, buku kas/bank, Rincian pengawas,
 * pencairan EDC, penebusan) diubah menjadi jurnal debet-kredit. Satu fungsi per
 * aturan P; `turunkanHari` merakit seluruh jurnal satu unit-hari. Pembacanya ada
 * di `buku-besar-sumber.ts`, penulisnya di `buku-besar-tulis.ts`.
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Sen bulat, bukan float.** Setiap nilai uang adalah bilangan bulat sen.
 *    Liter × harga dihitung dalam BigInt (mililiter × 1/10.000 Rp) dan
 *    dibulatkan setengah ke atas SEKALI per (unit, tanggal, produk, aturan).
 * 2. **Tidak ada angka penyeimbang** (Key Decision terakhir). Bila sebuah nilai
 *    tak bisa dihitung — harga beli kosong (R11), saldo awal persediaan belum
 *    diisi, rekening tanpa sub-pos — jurnalnya TIDAK dibuat dan sebuah
 *    {@link Temuan} menamai sebabnya. Selisih yang memang aturan (5120, 5130,
 *    1198) hanya lahir dari aturan yang menyebutnya.
 * 3. **HPP = liter terjual × harga beli terakhir** (KTD4, AE11). Penebusan
 *    menambah 1132, tidak pernah HPP. Liter terjual = volume − tera, rumus §1.1
 *    yang sama dengan `keuangan-mesin.ts`.
 * 4. **Setiap jurnal seimbang** — {@link buatJurnal} melempar galat bila tidak.
 *    Itu salah program, bukan data; DB menegakkannya lagi (trigger tunda 0058).
 * 5. **Kunci sumber stabil** (KTD3): (tabel sumber, id sumber, aturan). Masukan
 *    yang sama menghasilkan jurnal yang sama persis, termasuk urutannya.
 */

/** Buku besar dimulai bersama cut-over Keuangan (Key Decision tanggal mulai). */
export { MULAI_BUKU_BESAR } from "./buku-besar-bulan";
import { MULAI_BUKU_BESAR } from "./buku-besar-bulan";
/** Saldo awal pos per tanggal ini (R9, P22). */
export const TANGGAL_SALDO_AWAL = "2026-09-30";

/** Pos yang disebut aturan posting. Sub-pos bank (111x) dipetakan per unit. */
export const POS = {
  KAS_BESAR: "1101",
  EDC_PENAMPUNGAN: "1102",
  BELUM_DISETOR: "1103",
  PIUTANG_EASYMAX: "1121",
  PIUTANG_ANTAR_CABANG: "1122",
  PIUTANG_LAIN: "1129",
  PERSEDIAAN_TANGKI: "1131",
  SO_DIBAYAR: "1132",
  PAJAK_DIBAYAR_DI_MUKA: "1140",
  INVESTASI_SEMENTARA: "1150",
  DANA_DALAM_PERJALANAN: "1190",
  BELUM_DIPETAKAN: "1198",
  BELUM_TERIDENTIFIKASI: "1199",
  DEPOSIT_EASYMAX: "2101",
  HUTANG_ANTAR_CABANG: "2102",
  TITIPAN: "2103",
  HUTANG_LAIN: "2109",
  MODAL: "3100",
  PRIVE: "3300",
  PENJUALAN: "4100",
  TERA: "4110",
  PENDAPATAN_LAIN: "4200",
  HPP: "5100",
  SUSUT: "5110",
  SELISIH_HARGA: "5120",
  SELISIH_KAS: "5130",
  BEBAN_BANK: "5500",
  BEBAN_LAIN: "5700",
} as const;

export type KodeAturan =
  | "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10"
  | "P11" | "P12" | "P13" | "P14" | "P15" | "P16" | "P17" | "P18" | "P19" | "P20"
  | "P21" | "P22" | "P23" | "P24" | "P25" | "P26" | "P27" | "P28"
  | "ADJ-FWD";

/** Satu sisi jurnal. Tepat satu dari debet/kredit > 0 (CHECK 0058). */
export interface BarisJurnal {
  posKode: string;
  debetSen: number;
  kreditSen: number;
}

/** Tabel asal kunci sumber (`app.jurnal.sumber_tabel`). */
export type SumberTabel =
  | "cash_ledger"
  | "manual_entry"
  | "edc_settlement"
  | "easymax_produk"
  | "easymax_pelanggan"
  | "buku_besar_hari"
  | "day_close";

export interface JurnalTurunan {
  sumberTabel: SumberTabel;
  sumberId: string;
  aturan: KodeAturan;
  /** Tanggal asal (R33): `tanggal_asal` baris yang terdorong maju, kalau tidak hari buku. */
  tanggalEfektif: string;
  keterangan: string;
  /** Rapi: satu baris per pos, urut kode, tanpa nol. */
  baris: BarisJurnal[];
}

export type KodeTemuan =
  | "harga_beli_kosong"
  | "harga_jual_kosong"
  | "losses_gain_kosong"
  | "stok_kosong"
  | "saldo_awal_persediaan_kosong"
  | "pos_akun_tak_dikenal"
  | "pos_kategori_kosong"
  | "kategori_kosong"
  | "kategori_tak_dikenal"
  | "belum_tertaut"
  | "tautan_tak_seimbang"
  | "pencairan_tak_seimbang"
  | "sisa_1103_belum_disetujui";

/** Sesuatu yang membuat jurnal tidak dibuat, atau dibuat ke pos kliring. Ditampilkan, tidak ditebak. */
export interface Temuan {
  kode: KodeTemuan;
  pesan: string;
  sumberId?: string;
  produk?: string;
}

// ---------------------------------------------------------------------------
// Aritmetika sen
// ---------------------------------------------------------------------------

/** Bagi bulat, setengah menjauh dari nol (setengah ke atas pada besaran). */
function bagiBulat(n: bigint, d: bigint): number {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (a * 2n + d) / (2n * d);
  const hasil = Number(neg ? -q : q);
  if (!Number.isSafeInteger(hasil)) throw new Error(`Nilai sen di luar jangkauan aman: ${hasil}`);
  return hasil;
}

const RUPIAH_RE = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Rupiah desimal (teks dari `numeric::text`, atau angka) → sen, persis.
 * Teks dipakai untuk kolom DECIMAL(17,2) supaya tak melewati float.
 */
export function senDariRupiah(v: string | number): number {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Nominal tidak sah: ${v}`);
    return Math.round(v * 100);
  }
  const m = RUPIAH_RE.exec(v.trim());
  if (!m) throw new Error(`Nominal tidak sah: "${v}"`);
  const sen = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -sen : sen;
}

/** Liter × harga per liter → sen, dibulatkan setengah ke atas SEKALI. */
export function senLiterKaliHarga(liter: number, harga: number): number {
  const ml = BigInt(Math.round(liter * 1000));
  const h = BigInt(Math.round(harga * 10_000));
  // sen = (ml/1000) × (h/10.000) × 100
  return bagiBulat(ml * h, 100_000n);
}

// ---------------------------------------------------------------------------
// Jurnal
// ---------------------------------------------------------------------------

/** Sisi bertanda: positif = debet, negatif = kredit. */
function kaki(posKode: string, sen: number): BarisJurnal[] {
  if (sen > 0) return [{ posKode, debetSen: sen, kreditSen: 0 }];
  if (sen < 0) return [{ posKode, debetSen: 0, kreditSen: -sen }];
  return [];
}

/** Net per pos, tanpa nol, urut kode — bentuk baku untuk dibandingkan dan disimpan. */
export function rapikan(baris: readonly BarisJurnal[]): BarisJurnal[] {
  const net = new Map<string, number>();
  for (const b of baris) net.set(b.posKode, (net.get(b.posKode) ?? 0) + b.debetSen - b.kreditSen);
  return [...net.entries()]
    .filter(([, v]) => v !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([k, v]) => kaki(k, v));
}

export function seimbang(baris: readonly BarisJurnal[]): boolean {
  let d = 0;
  let k = 0;
  for (const b of baris) {
    d += b.debetSen;
    k += b.kreditSen;
  }
  return d === k;
}

function buatJurnal(
  sumberTabel: SumberTabel,
  sumberId: string,
  aturan: KodeAturan,
  tanggalEfektif: string,
  keterangan: string,
  baris: readonly BarisJurnal[],
): JurnalTurunan | null {
  const rapi = rapikan(baris);
  if (rapi.length === 0) return null;
  if (!seimbang(rapi)) {
    throw new Error(`Jurnal ${aturan} ${sumberTabel}/${sumberId} tidak seimbang — salah aturan posting.`);
  }
  return { sumberTabel, sumberId, aturan, tanggalEfektif, keterangan, baris: rapi };
}

/** Selisih per pos `turunan − tersimpan` — isi jurnal koreksi maju (KTD3). */
export function deltaMaju(tersimpan: readonly BarisJurnal[], turunan: readonly BarisJurnal[]): BarisJurnal[] {
  return rapikan([...turunan, ...tersimpan.map((b) => ({ posKode: b.posKode, debetSen: b.kreditSen, kreditSen: b.debetSen }))]);
}

/** Net (debet − kredit) satu pos di sekumpulan baris. */
function netPos(baris: readonly BarisJurnal[], posKode: string): number {
  let s = 0;
  for (const b of baris) if (b.posKode === posKode) s += b.debetSen - b.kreditSen;
  return s;
}

// ---------------------------------------------------------------------------
// EasyMax per produk: P1, P8, P9, P10
// ---------------------------------------------------------------------------

/** Satu produk pada satu hari, dari bahan laporan rumus (`getBahanLaporan`). `null` = tak diketahui. */
export interface ProdukHari {
  produk: string;
  /** Liter terjual kotor (belum dikurangi tera). */
  volumeL: number;
  teraL: number;
  hargaJual: number | null;
  /** Harga beli terakhir yang berlaku pada tanggal itu (`effectiveBuyPrice`). */
  hargaBeli: number | null;
  /** Stok fisik penutup. */
  stokL: number | null;
  /** Gain (+) / losses (−) liter, metode RESUME. */
  lossesGainL: number | null;
  /** Liter BBM yang diterima dari SO hari itu (`getDoHarian.penerimaan`). */
  penerimaanL: number;
  /** Sisa SO aktif (sisa − macet). */
  sisaSoAktifL: number | null;
}

const kunciProduk = (tanggal: string, p: ProdukHari) => `${tanggal}|${p.produk}`;

/** P1 — penjualan per hari per produk: 1103 (tunai+EDC+tempo) · 4110 tera | 4100. */
export function p1Penjualan(tanggal: string, p: ProdukHari): JurnalTurunan | null {
  if (p.hargaJual === null) return null;
  const omzet = senLiterKaliHarga(p.volumeL, p.hargaJual);
  const tera = senLiterKaliHarga(p.teraL, p.hargaJual);
  return buatJurnal("easymax_produk", kunciProduk(tanggal, p), "P1", tanggal, `Penjualan ${p.produk}`, [
    ...kaki(POS.BELUM_DISETOR, omzet - tera),
    ...kaki(POS.TERA, tera),
    ...kaki(POS.PENJUALAN, -omzet),
  ]);
}

/** P8 — BBM diterima dari SO: 1131 | 1132, liter × harga beli terakhir. */
export function p8Penerimaan(tanggal: string, p: ProdukHari): JurnalTurunan | null {
  if (p.hargaBeli === null) return null;
  const v = senLiterKaliHarga(p.penerimaanL, p.hargaBeli);
  return buatJurnal("easymax_produk", kunciProduk(tanggal, p), "P8", tanggal, `Penerimaan BBM ${p.produk}`, [
    ...kaki(POS.PERSEDIAAN_TANGKI, v),
    ...kaki(POS.SO_DIBAYAR, -v),
  ]);
}

/** P9 — HPP harian: 5100 | 1131, (volume − tera) × harga beli terakhir, dibulatkan sekali. */
export function p9Hpp(tanggal: string, p: ProdukHari): JurnalTurunan | null {
  if (p.hargaBeli === null) return null;
  const literBersih = (Math.round(p.volumeL * 1000) - Math.round(p.teraL * 1000)) / 1000;
  const v = senLiterKaliHarga(literBersih, p.hargaBeli);
  return buatJurnal("easymax_produk", kunciProduk(tanggal, p), "P9", tanggal, `HPP ${p.produk}`, [
    ...kaki(POS.HPP, v),
    ...kaki(POS.PERSEDIAAN_TANGKI, -v),
  ]);
}

/** P10 — losses 5110 | 1131; gain sisi terbalik. */
export function p10LossesGain(tanggal: string, p: ProdukHari): JurnalTurunan | null {
  if (p.hargaBeli === null || p.lossesGainL === null) return null;
  const v = senLiterKaliHarga(p.lossesGainL, p.hargaBeli);
  return buatJurnal("easymax_produk", kunciProduk(tanggal, p), "P10", tanggal, `Losses/gain ${p.produk}`, [
    ...kaki(POS.PERSEDIAAN_TANGKI, v),
    ...kaki(POS.SUSUT, -v),
  ]);
}

// ---------------------------------------------------------------------------
// Buku kas/bank: P2, P3, P6, P7, P11–P20, P26
// ---------------------------------------------------------------------------

/** Satu baris `cash_ledger` non-void, bukan saldo awal, beserta tautannya. */
export interface BarisKas {
  id: string;
  accountId: string;
  /** Bertanda: debet (masuk) > 0, kredit (keluar) < 0. */
  amountSen: number;
  kategori: string | null;
  keterangan: string;
  /** 0049 — tanggal asal bila dibukukan maju. */
  tanggalAsal: string | null;
  edcSettlementId: string | null;
  pasanganUuid: string | null;
  pihakLawanJenis: string | null;
  /** Baris Biaya/Pendapatan pintu Finance yang bertaut (0053), nominal POSITIF, pos efektif. */
  tertaut: { manualEntryId: string; posKode: string | null; amountSen: number }[];
  /** Penebusan non-void yang memiliki baris ini (0050). */
  penebusan: {
    id: string;
    netSen: number;
    ppnSen: number;
    pphSen: number;
    pbbkbSen: number;
    /** Bertanda: nota debet +, nota kredit −. */
    notaSen: number;
    grossSen: number;
  } | null;
}

/**
 * Setiap label `cash_mutation_category` → TEPAT SATU aturan (dijaga uji seed).
 * Penyempitan di dalam aturan: "Hutang Piutang" berpasangan antar unit jatuh ke
 * P14; "Pindah Buku" milik pencairan EDC dijurnal P5; "Biaya Operasional" /
 * "Pembelian BBM" tanpa tautan jatuh ke P26 (R27).
 */
export const ATURAN_KATEGORI_KAS: Readonly<Record<string, KodeAturan>> = {
  // 0029
  "Setoran Hasil Penjualan": "P2",
  "Pendapatan Lain-Lain": "P12",
  "Tambahan Modal": "P17",
  "Transfer Pembayaran Piutang Pelanggan": "P13",
  "Pindah Buku": "P6",
  "Hutang Piutang": "P15",
  "Temporary Investment": "P18",
  "Biaya Operasional": "P11",
  "Pembelian BBM": "P7",
  "Kontribusi ke Pusat": "P17",
  "Management Fee": "P20",
  "Setoran ke Bank": "P6",
  // 0043
  "Penjualan EDC": "P3",
  // 0045
  "Penyerahan titipan Bright": "P16",
  // 0049
  "Mutasi Belum Teridentifikasi": "P19",
  "Penyerahan titipan": "P16",
};

/** Seksi `manual_entry` → aturan (dijaga uji enum migrasi). Setoran tunai diwujudkan baris kasnya (P2). */
export const ATURAN_SEKSI_MANUAL: Readonly<Record<string, KodeAturan>> = {
  pengeluaran: "P4",
  pendapatan_lain: "P27",
  setoran_tunai: "P2",
};

/**
 * Komponen sumber Rincian Penjualan (A–I, `rincian-model.ts`) → aturan. E dan H
 * turunan (rumus `rekon.ts`), tidak dijurnal sendiri.
 */
export const ATURAN_KOMPONEN_RINCIAN: Readonly<Record<string, KodeAturan>> = {
  A: "P1", // omset
  B: "P1", // tera
  C: "P28", // pelanggan tempo — lewat penyesuaian piutang EasyMax
  D: "P3", // EDC — terposting saat slip = EasyMax
  F: "P27", // pendapatan lain pengawas (titipan: P16)
  G: "P4", // pengeluaran pengawas
  I: "P2", // setoran tunai
};

const efektif = (tanggal: string, row: { tanggalAsal: string | null }) => row.tanggalAsal ?? tanggal;

/** Akun kas/bank sisi bertanda + satu pos lawan. */
function lawan(tanggal: string, row: BarisKas, akun: string, aturan: KodeAturan, posLawan: string): JurnalTurunan | null {
  return buatJurnal("cash_ledger", row.id, aturan, efektif(tanggal, row), row.keterangan, [
    ...kaki(akun, row.amountSen),
    ...kaki(posLawan, -row.amountSen),
  ]);
}

/** P2 — setoran tunai pengawas: 1101 | 1103. */
export const p2SetoranTunai = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P2", POS.BELUM_DISETOR);
/** P3 — EDC per shift: 1102 | 1103. */
export const p3PenjualanEdc = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P3", POS.BELUM_DISETOR);
/**
 * P6 — setoran ke bank / pindah buku antar rekening sendiri. Setiap kaki lewat
 * 1190: dua kaki bertanggal sama saling menolkan 1190 di hari itu; bertanggal
 * beda meninggalkan butir dalam perjalanan (R33) — saldo akhirnya sama dengan
 * "langsung bila tanggal sama, lewat 1190 bila beda".
 */
export const p6PindahBuku = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P6", POS.DANA_DALAM_PERJALANAN);
/**
 * P12 — pendapatan lain-lain dari buku kas/bank: kas/bank | 4200 (R26). Baris
 * tertaut yang HoF reklasifikasi ke pos neraca (kelas 1–3, mis. 3-9100 → 3300)
 * mengikuti pos itu; pos laba atau tanpa pos tetap 4200 (U2), begitu pula sisa
 * nominal yang belum tertaut.
 */
export function p12PendapatanLain(tanggal: string, row: BarisKas, akun: string): JurnalTurunan | null {
  if (row.tertaut.length === 0) return lawan(tanggal, row, akun, "P12", POS.PENDAPATAN_LAIN);
  const arah = row.amountSen < 0 ? 1 : -1;
  const baris: BarisJurnal[] = [...kaki(akun, row.amountSen)];
  let terpakai = 0;
  for (const t of row.tertaut) {
    const neraca = t.posKode !== null && /^[123]/.test(t.posKode);
    baris.push(...kaki(neraca ? t.posKode! : POS.PENDAPATAN_LAIN, arah * t.amountSen));
    terpakai += arah * t.amountSen;
  }
  const sisa = -row.amountSen - terpakai;
  if (sisa !== 0) baris.push(...kaki(POS.PENDAPATAN_LAIN, sisa));
  return buatJurnal("cash_ledger", row.id, "P12", efektif(tanggal, row), row.keterangan, baris);
}
/** P13 — pembayaran pelanggan EasyMax lewat transfer: 111x | 1121. */
export const p13PembayaranPiutang = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P13", POS.PIUTANG_EASYMAX);
/** P14 — pinjaman antar unit: keluar = 1122 (pemberi), masuk = 2102 (penerima). */
export const p14AntarUnit = (t: string, r: BarisKas, akun: string) =>
  lawan(t, r, akun, "P14", r.amountSen < 0 ? POS.PIUTANG_ANTAR_CABANG : POS.HUTANG_ANTAR_CABANG);
/** P15 — hutang piutang non-EasyMax: keluar = 1129, masuk = 2109 (sesuai arah). */
export const p15HutangPiutang = (t: string, r: BarisKas, akun: string) =>
  lawan(t, r, akun, "P15", r.amountSen < 0 ? POS.PIUTANG_LAIN : POS.HUTANG_LAIN);
/** P16 — titipan diserahkan: 2103 | kas/bank. */
export const p16PenyerahanTitipan = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P16", POS.TITIPAN);
/** P17 — tambahan modal (3100) / prive & kontribusi ke pusat (3300). */
export const p17Modal = (t: string, r: BarisKas, akun: string) =>
  lawan(t, r, akun, "P17", r.kategori === "Tambahan Modal" ? POS.MODAL : POS.PRIVE);
/** P18 — investasi sementara: 1150 berlawanan dengan kas/bank. */
export const p18InvestasiSementara = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P18", POS.INVESTASI_SEMENTARA);
/** P19 — mutasi belum teridentifikasi (diparkir): 1199. */
export const p19Parkir = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P19", POS.BELUM_TERIDENTIFIKASI);
/** P26 — baris belum tertaut (R27): 1198 berlawanan dengan kas/bank. */
export const p26BelumTertautKas = (t: string, r: BarisKas, akun: string) => lawan(t, r, akun, "P26", POS.BELUM_DIPETAKAN);

/**
 * Kas/bank vs pos baris Biaya yang bertaut (P11, P20). Selisih jumlah tautan
 * dengan nominal kas (mis. pecahan yang belum lengkap) masuk 1198 sebagai temuan.
 */
function denganTautan(
  tanggal: string,
  row: BarisKas,
  akun: string,
  aturan: "P11" | "P20",
  posBawaan: string | null,
): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  const temuan: Temuan[] = [];
  const arah = row.amountSen < 0 ? 1 : -1; // kas keluar ⇒ beban di debet
  const baris: BarisJurnal[] = [...kaki(akun, row.amountSen)];
  let terpakai = 0;
  for (const t of row.tertaut) {
    const pos = t.posKode ?? POS.BELUM_DIPETAKAN;
    if (t.posKode === null) {
      temuan.push({ kode: "pos_kategori_kosong", pesan: `Baris Biaya bertaut tanpa pos — masuk 1198 sampai dipetakan.`, sumberId: t.manualEntryId });
    }
    baris.push(...kaki(pos, arah * t.amountSen));
    terpakai += arah * t.amountSen;
  }
  const sisa = -row.amountSen - terpakai;
  if (sisa !== 0) {
    if (row.tertaut.length === 0 && posBawaan !== null) {
      baris.push(...kaki(posBawaan, sisa));
    } else {
      baris.push(...kaki(POS.BELUM_DIPETAKAN, sisa));
      temuan.push(
        row.tertaut.length === 0
          ? { kode: "belum_tertaut", pesan: `Mutasi "${row.kategori}" tanpa baris Biaya — masuk 1198 sampai ditautkan (R27).`, sumberId: row.id }
          : { kode: "tautan_tak_seimbang", pesan: `Baris Biaya bertaut tidak sama dengan nominal mutasi — sisanya masuk 1198.`, sumberId: row.id },
      );
    }
  }
  const aturanAkhir = row.tertaut.length === 0 && posBawaan === null ? "P26" : aturan;
  return { jurnal: buatJurnal("cash_ledger", row.id, aturanAkhir, efektif(tanggal, row), row.keterangan, baris), temuan };
}

/** P11 — biaya dari buku kas/bank: pos kategori | kas/bank. Tanpa tautan → P26 (1198). */
export const p11Biaya = (t: string, r: BarisKas, akun: string) => denganTautan(t, r, akun, "P11", null);
/** P20 — management fee: pos yang HoF tetapkan (bawaan 5700) | kas/bank. */
export const p20ManagementFee = (t: string, r: BarisKas, akun: string) => denganTautan(t, r, akun, "P20", POS.BEBAN_LAIN);

/**
 * P7 — penebusan SO: 1132 (Net + PBBKB + Nota) · 1140 (PPN, PPh) | 111x (Gross).
 * Tanpa penebusan → P26 (R27). Komponen ≠ nominal kas → sisanya 1198 + temuan.
 */
export function p7Penebusan(tanggal: string, row: BarisKas, akun: string): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  const pb = row.penebusan;
  if (pb === null) {
    return {
      jurnal: p26BelumTertautKas(tanggal, row, akun),
      temuan: [{ kode: "belum_tertaut", pesan: "Mutasi Pembelian BBM tanpa penebusan — masuk 1198 sampai SO-nya dicatat (R27).", sumberId: row.id }],
    };
  }
  const temuan: Temuan[] = [];
  const arah = row.amountSen < 0 ? 1 : -1;
  const so = arah * (pb.netSen + pb.pbbkbSen + pb.notaSen);
  const pajak = arah * (pb.ppnSen + pb.pphSen);
  const sisa = -row.amountSen - so - pajak;
  if (sisa !== 0) {
    temuan.push({ kode: "tautan_tak_seimbang", pesan: "Komponen penebusan tidak sama dengan nominal mutasi — sisanya masuk 1198.", sumberId: row.id });
  }
  return {
    jurnal: buatJurnal("cash_ledger", row.id, "P7", efektif(tanggal, row), row.keterangan, [
      ...kaki(akun, row.amountSen),
      ...kaki(POS.SO_DIBAYAR, so),
      ...kaki(POS.PAJAK_DIBAYAR_DI_MUKA, pajak),
      ...kaki(POS.BELUM_DIPETAKAN, sisa),
    ]),
    temuan,
  };
}

/**
 * Satu baris kas → jurnalnya. `posAkun` = pos rekening itu (1101/1102/111x);
 * `null` ⇒ tidak dijurnal + temuan (rekening bank tanpa sub-pos). Baris milik
 * pencairan EDC tidak diproses di sini (P5, {@link p5PencairanEdc}).
 */
export function jurnalKas(tanggal: string, row: BarisKas, posAkun: string | null): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  if (posAkun === null) {
    return { jurnal: null, temuan: [{ kode: "pos_akun_tak_dikenal", pesan: "Rekening tanpa sub-pos — mutasi tidak dijurnal.", sumberId: row.id }] };
  }
  if (row.kategori === null) {
    return {
      jurnal: p26BelumTertautKas(tanggal, row, posAkun),
      temuan: [{ kode: "kategori_kosong", pesan: "Mutasi tanpa kategori — masuk 1198.", sumberId: row.id }],
    };
  }
  const tunggal = (j: JurnalTurunan | null) => ({ jurnal: j, temuan: [] as Temuan[] });
  switch (ATURAN_KATEGORI_KAS[row.kategori]) {
    case "P2": return tunggal(p2SetoranTunai(tanggal, row, posAkun));
    case "P3": return tunggal(p3PenjualanEdc(tanggal, row, posAkun));
    case "P6": return tunggal(p6PindahBuku(tanggal, row, posAkun));
    case "P7": return p7Penebusan(tanggal, row, posAkun);
    case "P11": return p11Biaya(tanggal, row, posAkun);
    case "P12": return tunggal(p12PendapatanLain(tanggal, row, posAkun));
    case "P13": return tunggal(p13PembayaranPiutang(tanggal, row, posAkun));
    case "P15":
      return tunggal(
        row.pasanganUuid !== null || row.pihakLawanJenis === "unit"
          ? p14AntarUnit(tanggal, row, posAkun)
          : p15HutangPiutang(tanggal, row, posAkun),
      );
    case "P16": return tunggal(p16PenyerahanTitipan(tanggal, row, posAkun));
    case "P17": return tunggal(p17Modal(tanggal, row, posAkun));
    case "P18": return tunggal(p18InvestasiSementara(tanggal, row, posAkun));
    case "P19": return tunggal(p19Parkir(tanggal, row, posAkun));
    case "P20": return p20ManagementFee(tanggal, row, posAkun);
    default:
      return {
        jurnal: p26BelumTertautKas(tanggal, row, posAkun),
        temuan: [{ kode: "kategori_tak_dikenal", pesan: `Kategori "${row.kategori}" belum punya aturan posting — masuk 1198.`, sumberId: row.id }],
      };
  }
}

/** Pencairan EDC: baris kas bertanda milik satu settlement + beban MDR non-kasnya. */
export interface PencairanEdc {
  settlementId: string;
  tanggalEfektif: string;
  /** Kaki kas (bertanda) dengan pos rekeningnya. `posKode null` = rekening tanpa sub-pos. */
  legs: { posKode: string | null; amountSen: number }[];
  /** Σ `noncash_expense` settlement itu (MDR, positif). */
  mdrSen: number;
}

/** P5 — pencairan EDC (3 kaki, sudah ada): 111x neto · 5500 MDR | 1102 bruto. */
export function p5PencairanEdc(tanggal: string, g: PencairanEdc): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  if (g.legs.some((l) => l.posKode === null)) {
    return {
      jurnal: null,
      temuan: [{ kode: "pos_akun_tak_dikenal", pesan: "Rekening pencairan tanpa sub-pos — pencairan tidak dijurnal.", sumberId: g.settlementId }],
    };
  }
  const baris: BarisJurnal[] = [...g.legs.flatMap((l) => kaki(l.posKode!, l.amountSen)), ...kaki(POS.BEBAN_BANK, g.mdrSen)];
  const sisa = -(g.legs.reduce((s, l) => s + l.amountSen, 0) + g.mdrSen);
  const temuan: Temuan[] =
    sisa === 0 ? [] : [{ kode: "pencairan_tak_seimbang", pesan: "Kaki pencairan EDC tidak menutup (bruto ≠ neto + MDR) — sisanya masuk 1198.", sumberId: g.settlementId }];
  baris.push(...kaki(POS.BELUM_DIPETAKAN, sisa));
  return { jurnal: buatJurnal("edc_settlement", g.settlementId, "P5", g.tanggalEfektif, "Pencairan EDC", baris), temuan };
}

// ---------------------------------------------------------------------------
// Rincian pengawas & baris Finance tanpa mutasi: P4, P16, P27, P26
// ---------------------------------------------------------------------------

/** Baris `manual_entry` non-void yang TIDAK diwujudkan baris kas aktif. */
export interface BarisManual {
  id: string;
  section: "pengeluaran" | "pendapatan_lain" | "setoran_tunai";
  sourceDoor: "pengawas" | "finance";
  /** Nominal POSITIF (`nominalManualEntry`). */
  amountSen: number;
  /** Pos dari akun efektif (reklasifikasi terakhir, kode lama diterjemahkan). `null` = belum dipetakan. */
  posKode: string | null;
  /** Titipan outlet (§10.27, `sqlTitipan`). */
  titipan: boolean;
  keterangan: string;
}

/** Pendapatan lain berkode beban (R26) atau tanpa kode tetap 4200; kode modal/kewajiban/aset (reklasifikasi) dihormati. */
function posPendapatanLain(posKode: string | null): string {
  return posKode === null || posKode.startsWith("5") ? POS.PENDAPATAN_LAIN : posKode;
}

export function jurnalManual(tanggal: string, m: BarisManual): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  if (m.section === "setoran_tunai") return { jurnal: null, temuan: [] }; // diwujudkan baris kas (P2)
  const temuan: Temuan[] = [];
  const posBeban = m.posKode ?? POS.BELUM_DIPETAKAN;
  if (m.section === "pengeluaran" && m.posKode === null) {
    temuan.push({ kode: "pos_kategori_kosong", pesan: "Pengeluaran tanpa pos — masuk 1198 sampai dipetakan.", sumberId: m.id });
  }
  const j = (aturan: KodeAturan, baris: BarisJurnal[]) => buatJurnal("manual_entry", m.id, aturan, tanggal, m.keterangan, baris);

  if (m.sourceDoor === "finance") {
    // R27: baris Biaya/Pendapatan Finance tanpa mutasi — lawannya 1198 sampai ditautkan.
    temuan.push({ kode: "belum_tertaut", pesan: "Baris Finance tanpa mutasi kas — masuk 1198 sampai ditautkan (R27).", sumberId: m.id });
    return m.section === "pengeluaran"
      ? { jurnal: j("P26", [...kaki(posBeban, m.amountSen), ...kaki(POS.BELUM_DIPETAKAN, -m.amountSen)]), temuan }
      : { jurnal: j("P26", [...kaki(POS.BELUM_DIPETAKAN, m.amountSen), ...kaki(posPendapatanLain(m.posKode), -m.amountSen)]), temuan };
  }
  if (m.section === "pengeluaran") {
    return { jurnal: j("P4", [...kaki(posBeban, m.amountSen), ...kaki(POS.BELUM_DISETOR, -m.amountSen)]), temuan };
  }
  if (m.titipan) {
    return { jurnal: j("P16", [...kaki(POS.BELUM_DISETOR, m.amountSen), ...kaki(POS.TITIPAN, -m.amountSen)]), temuan };
  }
  return { jurnal: j("P27", [...kaki(POS.BELUM_DISETOR, m.amountSen), ...kaki(posPendapatanLain(m.posKode), -m.amountSen)]), temuan };
}

// ---------------------------------------------------------------------------
// Penyesuaian harian: P28, P23, P24
// ---------------------------------------------------------------------------

/** Saldo pelanggan EasyMax pada dua batas hari (`getSaldoPelanggan`), sen. */
export interface SaldoPelangganHari {
  piutangAwalSen: number;
  piutangAkhirSen: number;
  /** Hutang lokal = deposit pelanggan (positif = kewajiban). */
  depositAwalSen: number;
  depositAkhirSen: number;
}

/**
 * P28 — 1121 dan 2101 disesuaikan ke saldo EasyMax akhir hari, lawan 1103.
 * Gerak 1121 jurnal lain hari itu (P13) dikurangkan, jadi saldo 1121 di akhir
 * hari = piutang EasyMax selama saldo awalnya = piutang EasyMax 30 Sep.
 */
export function p28Pelanggan(tanggal: string, s: SaldoPelangganHari | null, gerak1121Sen: number): JurnalTurunan | null {
  if (s === null) return null;
  const piutang = s.piutangAkhirSen - s.piutangAwalSen - gerak1121Sen;
  const deposit = s.depositAkhirSen - s.depositAwalSen;
  return buatJurnal("easymax_pelanggan", tanggal, "P28", tanggal, "Penyesuaian piutang & deposit pelanggan EasyMax", [
    ...kaki(POS.PIUTANG_EASYMAX, piutang),
    ...kaki(POS.DEPOSIT_EASYMAX, -deposit),
    ...kaki(POS.BELUM_DISETOR, -piutang + deposit),
  ]);
}

/** Saldo 1131/1132 SEBELUM P23 hari itu: saldo awal + jurnal bertanggal efektif lebih awal. `null` = saldo awal belum diisi. */
export interface SaldoPersediaan {
  s1131: number | null;
  s1132: number | null;
}

/** Target satu pos persediaan: Σ liter × harga. `null` bila ada produk berliter ≠ 0 tanpa harga, atau liternya tak diketahui. */
function targetNilai(produk: readonly ProdukHari[], liter: (p: ProdukHari) => number | null): { sen: number | null; kurang: ProdukHari[] } {
  let sen = 0;
  const kurang: ProdukHari[] = [];
  for (const p of produk) {
    const l = liter(p);
    if (l === 0) continue;
    if (l === null || p.hargaBeli === null) {
      kurang.push(p);
      continue;
    }
    sen += senLiterKaliHarga(l, p.hargaBeli);
  }
  return { sen: kurang.length > 0 ? null : sen, kurang };
}

/**
 * P23 — penyesuaian nilai harian (KTD4): 1131 ke Σ stok × harga beli terakhir,
 * 1132 ke Σ sisa SO aktif × harga beli terakhir, lawan 5120. `gerakHariIni` =
 * net 1131/1132 jurnal lain hari itu (P7, P8, P9, P10), jadi yang dinilai ulang
 * hanya selisih harga, bukan gerak barangnya.
 *
 * ⛔ Satu produk tanpa harga/stok ⇒ pos itu TIDAK dinilai sama sekali. Menilai
 *    sebagian akan menghapus nilai produk itu dari 1131 lewat 5120.
 */
export function p23Revaluasi(
  tanggal: string,
  produk: readonly ProdukHari[],
  saldo: SaldoPersediaan,
  gerakHariIni: { g1131: number; g1132: number },
): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  const temuan: Temuan[] = [];
  const t1131 = targetNilai(produk, (p) => p.stokL);
  const t1132 = targetNilai(produk, (p) => p.sisaSoAktifL);
  for (const p of t1131.kurang) {
    if (p.stokL === null) temuan.push({ kode: "stok_kosong", pesan: `Stok ${p.produk} tidak diketahui — 1131 tidak dinilai ulang.`, produk: p.produk });
  }
  if (saldo.s1131 === null || saldo.s1132 === null) {
    temuan.push({
      kode: "saldo_awal_persediaan_kosong",
      pesan: "Saldo awal pos 1131/1132 belum diisi — penilaian persediaan menunggu (tanpa angka penyeimbang).",
    });
  }
  const adj1131 = t1131.sen === null || saldo.s1131 === null ? 0 : t1131.sen - (saldo.s1131 + gerakHariIni.g1131);
  const adj1132 = t1132.sen === null || saldo.s1132 === null ? 0 : t1132.sen - (saldo.s1132 + gerakHariIni.g1132);
  return {
    jurnal: buatJurnal("buku_besar_hari", tanggal, "P23", tanggal, "Penyesuaian nilai persediaan ke harga beli terakhir", [
      ...kaki(POS.PERSEDIAAN_TANGKI, adj1131),
      ...kaki(POS.SO_DIBAYAR, adj1132),
      ...kaki(POS.SELISIH_HARGA, -(adj1131 + adj1132)),
    ]),
    temuan,
  };
}

/** Status tutup hari yang menentukan P24 (baris `day_close`). */
export interface TutupHariInfo {
  ditutup: boolean;
  tier: Tier;
  /** `approved_by_user_id` terisi (persetujuan tingkat 2/3). */
  disetujui: boolean;
}

const TINGKAT: Record<Tier, number> = { within_tolerance: 0, exception_hof: 1, override_direksi: 2 };

/**
 * P24 — sisa 1103 hari itu pindah ke 5130 HANYA bila tingkat toleransi sisa itu
 * (tangga §3.2 yang sama) sudah tercakup persetujuan tutup hari (KTD5). Bila
 * belum, sisa tetap di 1103 sebagai temuan dan menahan tutup bulan.
 */
export function p24SelisihKas(
  tanggal: string,
  sisa1103Sen: number,
  tutup: TutupHariInfo | null,
): { jurnal: JurnalTurunan | null; temuan: Temuan[] } {
  if (sisa1103Sen === 0 || tutup === null || !tutup.ditutup) return { jurnal: null, temuan: [] };
  const cakupan = tutup.tier === "within_tolerance" ? 0 : tutup.disetujui ? TINGKAT[tutup.tier] : -1;
  const perlu = TINGKAT[tierFor(sisa1103Sen / 100)];
  if (cakupan < perlu) {
    return {
      jurnal: null,
      temuan: [{
        kode: "sisa_1103_belum_disetujui",
        pesan: `Sisa Penjualan Belum Disetor Rp ${(sisa1103Sen / 100).toLocaleString("id-ID")} belum disetujui pada tingkat toleransinya — tetap di 1103.`,
        sumberId: tanggal,
      }],
    };
  }
  return {
    jurnal: buatJurnal("day_close", tanggal, "P24", tanggal, "Selisih kas yang disetujui di tutup hari", [
      ...kaki(POS.SELISIH_KAS, sisa1103Sen),
      ...kaki(POS.BELUM_DISETOR, -sisa1103Sen),
    ]),
    temuan: [],
  };
}

// ---------------------------------------------------------------------------
// Satu unit-hari
// ---------------------------------------------------------------------------

export interface MasukanHari {
  tanggal: string;
  /**
   * Produk EasyMax hari itu. `null` = tidak dibaca (pembentukan per sumber):
   * aturan harian P1, P8–P10, P23, P24, P28 tidak diturunkan.
   */
  produk: ProdukHari[] | null;
  pelanggan: SaldoPelangganHari | null;
  kas: BarisKas[];
  pencairan: PencairanEdc[];
  manual: BarisManual[];
  /** accountId → pos rekening (1101/1102/111x); `null` = tanpa sub-pos. */
  posAkun: Readonly<Record<string, string | null>>;
  saldoPersediaan: SaldoPersediaan;
  /** Net 1103 dari jurnal memorial bertanggal efektif hari itu — ikut sisa P24. */
  memorial1103Sen: number;
  tutupHari: TutupHariInfo | null;
}

export interface HasilTurunan {
  jurnal: JurnalTurunan[];
  temuan: Temuan[];
}

const kunciJurnal = (j: JurnalTurunan) => `${j.sumberTabel}|${j.sumberId}|${j.aturan}`;

export function turunkanHari(m: MasukanHari): HasilTurunan {
  const t = m.tanggal;
  const jurnal: JurnalTurunan[] = [];
  const temuan: Temuan[] = [];
  const tambah = (r: { jurnal: JurnalTurunan | null; temuan: Temuan[] }) => {
    if (r.jurnal) jurnal.push(r.jurnal);
    temuan.push(...r.temuan);
  };

  for (const row of m.kas) {
    if (row.edcSettlementId !== null) continue; // P5
    tambah(jurnalKas(t, row, m.posAkun[row.accountId] ?? null));
  }
  for (const g of m.pencairan) tambah(p5PencairanEdc(t, g));
  for (const row of m.manual) tambah(jurnalManual(t, row));

  if (m.produk !== null) {
    for (const p of m.produk) {
      const p1 = p1Penjualan(t, p);
      if (p1) jurnal.push(p1);
      else if (p.volumeL !== 0 || p.teraL !== 0) {
        temuan.push({ kode: "harga_jual_kosong", pesan: `Harga jual ${p.produk} tidak diketahui — penjualan tidak dijurnal.`, produk: p.produk });
      }
      if (p.hargaBeli === null) {
        const aktif = p.volumeL !== 0 || p.penerimaanL !== 0 || (p.stokL ?? 0) !== 0 || (p.sisaSoAktifL ?? 0) !== 0;
        if (aktif) {
          temuan.push({
            kode: "harga_beli_kosong",
            pesan: `Harga beli ${p.produk} belum diisi untuk ${t} — HPP dan persediaan tidak diposting (R11).`,
            produk: p.produk,
          });
        }
        continue;
      }
      for (const j of [p8Penerimaan(t, p), p9Hpp(t, p), p10LossesGain(t, p)]) if (j) jurnal.push(j);
      if (p.lossesGainL === null) {
        temuan.push({ kode: "losses_gain_kosong", pesan: `Losses/gain ${p.produk} tak terhitung — P10 tidak diposting.`, produk: p.produk });
      }
    }

    const sementara = jurnal.flatMap((j) => j.baris);
    const p28 = p28Pelanggan(t, m.pelanggan, netPos(sementara, POS.PIUTANG_EASYMAX));
    if (p28) jurnal.push(p28);

    tambah(
      p23Revaluasi(t, m.produk, m.saldoPersediaan, {
        g1131: netPos(sementara, POS.PERSEDIAAN_TANGKI),
        g1132: netPos(sementara, POS.SO_DIBAYAR),
      }),
    );

    const sisa1103 = netPos(jurnal.flatMap((j) => j.baris), POS.BELUM_DISETOR) + m.memorial1103Sen;
    tambah(p24SelisihKas(t, sisa1103, m.tutupHari));
  }

  jurnal.sort((a, b) => kunciJurnal(a).localeCompare(kunciJurnal(b)));
  return { jurnal, temuan };
}

// ---------------------------------------------------------------------------
// Tanggal buku & mode pembentukan ulang (R13, KTD3)
// ---------------------------------------------------------------------------

const bulanDari = (tanggal: string) => tanggal.slice(0, 7);
const hariPertamaBulanBerikut = (tanggal: string) => {
  const [y, mo] = tanggal.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
};

/**
 * Tanggal buku jurnal bertanggal `tanggal` (memorial, koreksi). Garis bekunya
 * TUTUP BULAN (R13): selama bulan itu terbuka, jurnal tetap di tanggalnya
 * walau harinya sudah tutup hari. Bulan tertutup ⇒ hari pertama yang tidak
 * tutup hari di bulan terbuka berikutnya.
 */
export function tentukanTanggalBukuBesar(m: {
  tanggal: string;
  bulanTertutup: Iterable<string>;
  hariTertutup: Iterable<string>;
}): { tanggalBuku: string; maju: boolean } {
  const bulan = new Set(m.bulanTertutup);
  if (!bulan.has(bulanDari(m.tanggal))) return { tanggalBuku: m.tanggal, maju: false };
  const hari = new Set(m.hariTertutup);
  let d = hariPertamaBulanBerikut(m.tanggal);
  // Berhenti pasti: himpunan bulan dan hari tertutup terbatas.
  while (bulan.has(bulanDari(d)) || hari.has(d)) d = bulan.has(bulanDari(d)) ? hariPertamaBulanBerikut(d) : addDays(d, 1);
  return { tanggalBuku: d, maju: true };
}

/** `tutup_bulan` ada ⇒ tertutup; `buku_besar` (0058) membedakan tutup K5 dari tutup dengan buku besar. */
export type StatusBulan = "terbuka" | "tutup_k5" | "tutup_buku_besar";

export type ModeBentukUlang =
  | { mode: "langsung" | "koreksi_maju"; backfill: boolean }
  | { tolak: string };

/**
 * Cara membentuk ulang satu hari (KTD3):
 *   · bulan terbuka → tulis ulang langsung (idempoten, kunci sumber sama);
 *   · bulan tertutup, jalur biasa → satu jurnal koreksi maju sebesar selisihnya;
 *   · backfill → boleh menulis langsung ke bulan yang ditutup K5, bertanda
 *     backfill, SELAMA unit itu belum punya satu pun bulan yang ditutup dengan
 *     buku besar. Sesudahnya backfill ke bulan tertutup ditolak.
 */
export function modeBentukUlang(status: StatusBulan, o: { backfill: boolean; adaTutupBukuBesar: boolean }): ModeBentukUlang {
  if (status === "terbuka") return { mode: "langsung", backfill: false };
  if (!o.backfill) return { mode: "koreksi_maju", backfill: false };
  if (status === "tutup_buku_besar") {
    return { tolak: "bulan ini sudah ditutup dengan buku besar — jurnalnya beku; koreksi memakai jurnal bertanggal maju." };
  }
  if (o.adaTutupBukuBesar) {
    return { tolak: "unit ini sudah punya bulan yang ditutup dengan buku besar — backfill ke bulan tertutup tidak lagi diizinkan." };
  }
  return { mode: "langsung", backfill: true };
}

/** Batas panjang satu permintaan backfill (hari) — satu transaksi pendek per hari. */
export const MAKS_HARI_RENTANG = 92;

const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Periksa rentang backfill SEBELUM hari pertama ditulis. `null` = boleh. */
export function periksaRentangBackfill(m: {
  dari: string;
  sampai: string;
  bulanTertutup: readonly { bulan: string; bukuBesar: boolean }[];
}): string | null {
  if (!TANGGAL_RE.test(m.dari) || !TANGGAL_RE.test(m.sampai)) return "Tanggal harus berbentuk YYYY-MM-DD.";
  if (m.dari < MULAI_BUKU_BESAR) return `Buku besar dimulai ${MULAI_BUKU_BESAR} — rentang tidak boleh lebih awal.`;
  if (m.sampai < m.dari) return "Tanggal akhir lebih awal dari tanggal mulai.";
  let n = 0;
  for (let d = m.dari; d <= m.sampai; d = addDays(d, 1)) if (++n > MAKS_HARI_RENTANG) return `Rentang maksimal ${MAKS_HARI_RENTANG} hari per permintaan.`;
  const adaBb = m.bulanTertutup.some((b) => b.bukuBesar);
  for (const b of m.bulanTertutup) {
    if (b.bulan < bulanDari(m.dari) || b.bulan > bulanDari(m.sampai)) continue;
    const mode = modeBentukUlang(b.bukuBesar ? "tutup_buku_besar" : "tutup_k5", { backfill: true, adaTutupBukuBesar: adaBb });
    if ("tolak" in mode) return `Bulan ${b.bulan}: ${mode.tolak}`;
  }
  return null;
}
