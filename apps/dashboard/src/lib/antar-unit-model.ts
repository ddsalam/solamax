import { rupiahKeSen, type SaldoAwalPihakLawan } from "./pihak-lawan-model";

/**
 * Model MURNI pasangan antar unit (rencana 2026-10-29 U4; R3, R4, R5, R31;
 * KTD4). Tanpa I/O — dipakai server action, inti tulis, kueri, dan layar.
 *
 * ⛔ TIGA HAL YANG MENGIKAT:
 *
 * 1. **Arah = siapa membayar siapa.** Kaki PEMBERI selalu kredit (kas keluar,
 *    piutang ke lawan naik), kaki PENERIMA selalu debet (kas masuk, hutang ke
 *    lawan naik). `jenis` (pinjaman/pengembalian/titipan) hanya mengubah
 *    keterangan: pengembalian = pemberi yang dulu meminjam membayar kembali.
 * 2. **Kesamaan saldo (R4) DIHITUNG, tak disimpan.** Saldo pihak lawan =
 *    pembuka + (−Σ amount) (KTD2); piutang A ke B harus = hutang B ke A, yaitu
 *    `saldoA + saldoB = 0`, kecuali selisih yang seluruhnya dijelaskan pasangan
 *    yang satu kakinya sudah dibukukan dan kaki lainnya belum (R28 bisa
 *    mendorong kaki ke hari berbeda per unit).
 * 3. **Pembalik memakai `pasangan_uuid` yang SAMA** dan dikenali dari kode
 *    alasan majunya (`ADJ-FWD-REVERSAL`) — pembalik hanya pernah lahir untuk
 *    kaki yang harinya sudah tertutup, jadi ia selalu terdorong maju dan selalu
 *    membawa kode itu. Satu kunci pasangan = satu riwayat utuh.
 */

export const JENIS_ANTAR_UNIT = ["pinjaman", "pengembalian", "titipan"] as const;
export type JenisAntarUnit = (typeof JENIS_ANTAR_UNIT)[number];

export const LABEL_JENIS_ANTAR_UNIT: Record<JenisAntarUnit, string> = {
  pinjaman: "Pinjaman",
  pengembalian: "Pengembalian pinjaman",
  titipan: "Titipan",
};

/** Kategori kedua kaki — kategori pihak lawan (CHECK 0049 mewajibkan pihak lawan). */
export const KATEGORI_ANTAR_UNIT = "Hutang Piutang";
/** R28: kaki yang terdorong maju. */
export const KODE_MAJU_ANTAR_UNIT = "ADJ-FWD-INTERUNIT";
/** R28/R31: baris pembalik (selalu terdorong maju). */
export const KODE_MAJU_PEMBALIK = "ADJ-FWD-REVERSAL";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Penanda "satu PT" (R5, KTD1) — DITURUNKAN dari peta tenant (`public.unit.
 * tenant_id`, satu tenant = satu PT) saat baca, tidak disimpan. Pemanggil
 * memasok peta dari `DataScope.tenantPerUnit` (kueri kandidat unit yang sudah
 * ada — tanpa kueri tambahan).
 *
 * ⛔ Dulu membandingkan teks kop `config.ts` (`UNIT_DISPLAY[code].pt`), yang
 *    menyebut dirinya "teks sementara sampai data resmi per unit" — tanda
 *    badan hukum tak boleh bergantung pada teks kop surat.
 */
export function satuPt(a: string, b: string, tenant: ReadonlyMap<string, string | null>): boolean {
  if (a === b) return false;
  const ta = tenant.get(a);
  const tb = tenant.get(b);
  return ta != null && tb != null && ta === tb;
}

export interface MasukanAntarUnit {
  pemberiCode: string;
  pemberiAccountId: string;
  penerimaCode: string;
  penerimaAccountId: string;
  /** Rupiah, POSITIF — arahnya ditentukan pemberi/penerima, bukan tanda. */
  nominal: number;
  /** Tanggal transaksi; hari buku tiap kaki ditentukan penjaga U2. */
  tanggal: string;
  jenis: string;
  catatan?: string;
}

export type HasilPeriksaAntarUnit =
  | { ok: true; nominalSen: number; jenis: JenisAntarUnit; catatan: string }
  | { ok: false; error: string };

/** Validasi tulis tangan (tanpa zod) — pesan menyebut perbaikannya. */
export function periksaAntarUnit(m: MasukanAntarUnit): HasilPeriksaAntarUnit {
  if (m.pemberiCode === m.penerimaCode) {
    return { ok: false, error: "Unit pemberi dan penerima harus berbeda — pilih unit lawannya." };
  }
  if (!UUID_RE.test(m.pemberiAccountId) || !UUID_RE.test(m.penerimaAccountId)) {
    return { ok: false, error: "Pilih rekening di kedua unit." };
  }
  if (!DATE_RE.test(m.tanggal)) return { ok: false, error: "Tanggal tak valid." };
  if (!(JENIS_ANTAR_UNIT as readonly string[]).includes(m.jenis)) {
    return { ok: false, error: "Jenis harus pinjaman, pengembalian, atau titipan." };
  }
  const sen = rupiahKeSen(m.nominal);
  if (sen === null || sen <= 0) {
    return { ok: false, error: "Nominal harus lebih dari Rp 0 — ketik tanpa tanda minus; arahnya dari pilihan Pinjamkan ke / Terima dari." };
  }
  return { ok: true, nominalSen: sen, jenis: m.jenis as JenisAntarUnit, catatan: (m.catatan ?? "").trim() };
}

export function kakiAntarUnit(nominalSen: number): {
  pemberi: { jenis: "kredit"; amountSen: number };
  penerima: { jenis: "debet"; amountSen: number };
} {
  return { pemberi: { jenis: "kredit", amountSen: -nominalSen }, penerima: { jenis: "debet", amountSen: nominalSen } };
}

export function keteranganKaki(m: {
  jenis: JenisAntarUnit;
  peran: "pemberi" | "penerima";
  namaLawan: string;
  catatan: string;
}): string {
  const dasar = `${LABEL_JENIS_ANTAR_UNIT[m.jenis]} antar unit ${m.peran === "pemberi" ? "ke" : "dari"} ${m.namaLawan}`;
  const c = m.catatan.trim();
  return c === "" ? dasar : `${dasar} — ${c}`;
}

/** Sen bulat → teks `numeric` ("-500000000.00") — ke DB tanpa melewati float. */
export function senKeTeks(sen: number): string {
  if (!Number.isSafeInteger(sen)) throw new Error(`Nominal sen tak sah: ${sen}`);
  const a = Math.abs(sen);
  const teks = `${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
  return sen < 0 ? `-${teks}` : teks;
}

// ---------------------------------------------------------------------------
// Status kaki (R3) & kesamaan saldo pasangan (R4)
// ---------------------------------------------------------------------------

export type StatusKaki = "dalam_perjalanan" | "lunas_di_bank" | "dibatalkan";

export const LABEL_STATUS_KAKI: Record<StatusKaki, string> = {
  dalam_perjalanan: "dalam perjalanan",
  lunas_di_bank: "lunas di bank",
  dibatalkan: "dibalik",
};

/**
 * Status satu kaki: "dalam perjalanan" sampai mutasi bank unit itu sendiri
 * dicocokkan (R3). `dicocokkan` = id baris kas yang berada di kelompok cocok
 * aktif — dipasok pembaca U10 (mesin cocok); sampai U10 ada, himpunannya
 * kosong dan setiap kaki hidup berstatus dalam perjalanan.
 */
export function statusKaki(k: { id: string; void: boolean }, dicocokkan: ReadonlySet<string> = new Set()): StatusKaki {
  if (k.void) return "dibatalkan";
  return dicocokkan.has(k.id) ? "lunas_di_bank" : "dalam_perjalanan";
}

export interface MutasiPasangan {
  pasanganUuid: string | null;
  /** Hari buku (`business_date`). */
  businessDate: string;
  /** BERTANDA seperti `cash_ledger.amount`, dalam sen. */
  amountSen: number;
  void: boolean;
}

/** Satu sisi: baris kas unit itu yang berpihak lawan = unit lawannya. */
export interface SisiPasangan {
  saldoAwal: SaldoAwalPihakLawan | null;
  mutasi: readonly MutasiPasangan[];
}

export type StatusParitas = "seimbang" | "menunggu_sisi_lawan" | "tidak_seimbang";

export interface HasilParitas {
  /** Saldo A ke B; positif = piutang A. */
  saldoASen: number;
  /** Saldo B ke A; negatif = hutang B. */
  saldoBSen: number;
  /** `saldoA + saldoB` — nol bila kedua buku sama. */
  selisihSen: number;
  /** Bagian selisih yang dijelaskan pasangan setengah-dibukukan per `per`. */
  dalamJendelaSen: number;
  status: StatusParitas;
}

/**
 * Kesamaan saldo satu pasangan unit PADA AKHIR hari `per` (R4).
 *
 * "Tidak seimbang" hanya bila selisihnya TIDAK seluruhnya dijelaskan jendela:
 * pasangan (`pasangan_uuid`) yang sebagian barisnya sudah dibukukan ≤ `per` dan
 * sebagian lagi sesudahnya. Baris tanpa pasangan (Hutang Piutang yang diketik
 * sepihak ke pihak lawan berjenis unit) tak pernah punya jendela ⇒ cacat.
 */
export function paritasPasangan(a: { per: string; a: SisiPasangan; b: SisiPasangan }): HasilParitas {
  const dihitung = (s: SisiPasangan): MutasiPasangan[] => {
    const awal = s.saldoAwal;
    const berlaku = awal !== null && awal.tanggal <= a.per;
    return s.mutasi.filter(
      (m) => !m.void && m.businessDate <= a.per && !(berlaku && m.businessDate < awal!.tanggal),
    );
  };
  const saldo = (s: SisiPasangan, rows: MutasiPasangan[]): number => {
    const awal = s.saldoAwal !== null && s.saldoAwal.tanggal <= a.per ? s.saldoAwal.amountSen : 0;
    return rows.reduce((t, m) => t - m.amountSen, awal);
  };
  const ra = dihitung(a.a);
  const rb = dihitung(a.b);
  const saldoASen = saldo(a.a, ra) || 0;
  const saldoBSen = saldo(a.b, rb) || 0;
  const selisihSen = saldoASen + saldoBSen || 0;

  // Pasangan yang punya baris (hidup) SESUDAH `per` di salah satu sisi.
  const belum = new Set<string>();
  for (const m of [...a.a.mutasi, ...a.b.mutasi]) {
    if (!m.void && m.pasanganUuid !== null && m.businessDate > a.per) belum.add(m.pasanganUuid);
  }
  let dalamJendelaSen = 0;
  let adaJendela = false;
  for (const m of [...ra, ...rb]) {
    if (m.pasanganUuid !== null && belum.has(m.pasanganUuid)) {
      dalamJendelaSen -= m.amountSen;
      adaJendela = true;
    }
  }
  dalamJendelaSen = dalamJendelaSen || 0;
  const sisa = selisihSen - dalamJendelaSen;
  const status: StatusParitas = sisa !== 0 ? "tidak_seimbang" : adaJendela && selisihSen !== 0 ? "menunggu_sisi_lawan" : "seimbang";
  return { saldoASen, saldoBSen, selisihSen, dalamJendelaSen, status };
}

// ---------------------------------------------------------------------------
// Balik pasangan (R31)
// ---------------------------------------------------------------------------

export interface BarisPasangan {
  id: string;
  unitId: number;
  accountId: string;
  businessDate: string;
  amountSen: number;
  jenis: "debet" | "kredit" | "adjustment";
  categorySide: "debet" | "kredit" | null;
  categoryLabel: string | null;
  pihakLawanId: string | null;
  keterangan: string;
  void: boolean;
  alasanMaju: string | null;
}

export type RencanaBalik = { ok: true; kaki: BarisPasangan[] } | { ok: false; error: string };

/**
 * Vonis balik atas SEMUA baris satu `pasangan_uuid` (kedua unit, dibaca di
 * transaksi dengan kunci). Sah hanya bila tepat dua kaki asli, satu di tiap
 * unit yang lolos gerbang, keduanya hidup, saling meniadakan, dan belum ada
 * pembalik.
 */
export function rencanaBalik(rows: readonly BarisPasangan[], unitIds: readonly [number, number]): RencanaBalik {
  if (rows.length === 0) return { ok: false, error: "Pasangan tak ditemukan — muat ulang halaman." };
  const asli = rows.filter((r) => r.alasanMaju !== KODE_MAJU_PEMBALIK);
  if (asli.length !== rows.length || asli.some((r) => r.void)) {
    return { ok: false, error: "Pasangan ini sudah dibalik — tak ada yang dibalik lagi." };
  }
  const unit = new Set(asli.map((r) => r.unitId));
  if (asli.length !== 2 || unit.size !== 2 || !unitIds.every((u) => unit.has(u))) {
    return {
      ok: false,
      error: "Kaki pasangan tidak lengkap di kedua unit yang dipegang — ditolak utuh, tak ada kaki yang dibalik.",
    };
  }
  if (asli[0]!.amountSen + asli[1]!.amountSen !== 0 || asli.some((r) => r.categoryLabel !== KATEGORI_ANTAR_UNIT)) {
    return { ok: false, error: "Kaki pasangan tidak saling meniadakan — hubungi admin, jangan dibalik sepihak." };
  }
  return { ok: true, kaki: asli };
}

/** Baris pembalik MAJU satu kaki: tanda & sisi berlawanan, kategori/pihak lawan sama. */
export function barisPembalik(k: BarisPasangan): {
  jenis: "debet" | "kredit";
  categorySide: "debet" | "kredit";
  amountSen: number;
  keterangan: string;
} {
  const jenis = k.amountSen < 0 ? "debet" : "kredit";
  return { jenis, categorySide: jenis, amountSen: -k.amountSen, keterangan: `Pembalik — ${k.keterangan}` };
}

// ---------------------------------------------------------------------------
// Ringkasan daftar pasangan di halaman satu unit
// ---------------------------------------------------------------------------

export interface KakiUnitIni {
  id: string;
  pasanganUuid: string;
  lawanUnitId: number;
  businessDate: string;
  tanggalAsal: string | null;
  amountSen: number;
  void: boolean;
  alasanMaju: string | null;
  keterangan: string;
  akun: string;
}

export interface PasanganRingkas {
  pasanganUuid: string;
  kakiId: string;
  lawanUnitId: number;
  /** Kas keluar dari unit ini (piutang) = pinjamkan; kas masuk = terima. */
  arah: "pinjamkan" | "terima";
  /** Tanggal transaksi (tanggal asal bila terdorong maju). */
  tanggal: string;
  hariBuku: string;
  amountSen: number;
  keterangan: string;
  akun: string;
  dibalik: boolean;
  status: StatusKaki;
}

export function ringkasPasangan(rows: readonly KakiUnitIni[], dicocokkan: ReadonlySet<string> = new Set()): PasanganRingkas[] {
  const grup = new Map<string, KakiUnitIni[]>();
  for (const r of rows) grup.set(r.pasanganUuid, [...(grup.get(r.pasanganUuid) ?? []), r]);
  const hasil: PasanganRingkas[] = [];
  for (const [uuid, g] of grup) {
    const asli = g.find((r) => r.alasanMaju !== KODE_MAJU_PEMBALIK);
    if (!asli) continue;
    const dibalik = asli.void || g.some((r) => r.alasanMaju === KODE_MAJU_PEMBALIK);
    hasil.push({
      pasanganUuid: uuid,
      kakiId: asli.id,
      lawanUnitId: asli.lawanUnitId,
      arah: asli.amountSen < 0 ? "pinjamkan" : "terima",
      tanggal: asli.tanggalAsal ?? asli.businessDate,
      hariBuku: asli.businessDate,
      amountSen: Math.abs(asli.amountSen),
      keterangan: asli.keterangan,
      akun: asli.akun,
      dibalik,
      status: dibalik ? "dibatalkan" : statusKaki(asli, dicocokkan),
    });
  }
  return hasil.sort((x, y) => (x.tanggal < y.tanggal ? 1 : x.tanggal > y.tanggal ? -1 : 0));
}
