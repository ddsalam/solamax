import { kategoriCocok, tandaCocok, type SisiKategori } from "./keuangan-kas";

/**
 * Model MURNI pihak lawan (rencana 2026-10-29 U3; R1, R2, R7, R9; KTD1–KTD3).
 * Tanpa I/O — dipakai server action, kueri, dan layar dari SATU tempat.
 *
 * ⛔ TIGA HAL YANG MENGIKAT:
 *
 * 1. **Uang dibandingkan dalam SEN BULAT** (Implementation Constraints). Σ
 *    pecahan = nominal sumber diuji `===` atas bilangan bulat sen, tak pernah
 *    atas float rupiah — 6.000.000 + 500.000 harus PERSIS 6.500.000.
 * 2. **Tanda saldo: POSITIF = piutang** (pihak lawan berhutang ke unit),
 *    searah saldo pembuka 0049. Kas keluar ke pihak lawan (amount < 0) menambah
 *    piutang, kas masuk menguranginya ⇒ saldo = pembuka + (−Σ amount) (KTD2).
 * 3. **Saldo adalah TURUNAN** — tak pernah disimpan. Fungsi di bawah
 *    menghitungnya dari baris kas setiap kali dibaca, seperti saldo rekening.
 */

/**
 * Kategori kas yang WAJIB menyebut pihak lawan — SAMA PERSIS dengan CHECK
 * `cash_ledger_pihak_lawan_wajib` (0049, dijaga uji). "Penyerahan titipan
 * Bright" (0045) sengaja tidak termasuk: baris lamanya dikenali
 * `titipan-bright.ts` (KTD11).
 */
export const KATEGORI_PIHAK_LAWAN = ["Hutang Piutang", "Penyerahan titipan"] as const;

export function kategoriPihakLawan(label: string | null | undefined): boolean {
  return label != null && (KATEGORI_PIHAK_LAWAN as readonly string[]).includes(label);
}

/** Daftar TERTUTUP 0049 (`pihak_lawan_jenis`). */
export const JENIS_PIHAK_LAWAN = ["unit", "afiliasi", "titipan", "kreditur", "karyawan", "lain"] as const;
export type JenisPihakLawan = (typeof JENIS_PIHAK_LAWAN)[number];

/** Jenis `unit` disemai migrasi dari `public.unit` — tidak pernah dibuat tangan (R1). */
export const JENIS_DIBUAT_KEUANGAN: readonly JenisPihakLawan[] = [
  "afiliasi",
  "titipan",
  "kreditur",
  "karyawan",
  "lain",
];

export const LABEL_JENIS: Record<JenisPihakLawan, string> = {
  unit: "Unit SolaMax",
  afiliasi: "Afiliasi / holding",
  titipan: "Pemilik titipan",
  kreditur: "Kreditur",
  karyawan: "Karyawan",
  lain: "Lain-lain",
};

export function jenisSah(j: string): j is JenisPihakLawan {
  return (JENIS_PIHAK_LAWAN as readonly string[]).includes(j);
}

// ---------------------------------------------------------------------------
// Sen bulat
// ---------------------------------------------------------------------------

/**
 * Rupiah (dari formulir) → sen bulat; `null` bila bukan bilangan berhingga
 * ber-≤ 2 desimal. Ujinya `s / 100 === n`: derau float (0,1 + 0,2) ditolak,
 * bukan dibulatkan diam-diam menjadi angka yang tak pernah diketik siapa pun.
 */
export function rupiahKeSen(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  const s = Math.round(n * 100);
  if (!Number.isSafeInteger(s) || s / 100 !== n) return null;
  return s;
}

const NUMERIK_RE = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Teks `numeric` dari DB (`amount::text`) → sen bulat, TANPA melewati float. */
export function teksKeSen(t: string): number {
  const m = NUMERIK_RE.exec(t.trim());
  if (!m) throw new Error(`Nominal DB tak terbaca: "${t}".`);
  const sen = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(sen)) throw new Error(`Nominal DB di luar jangkauan: "${t}".`);
  return m[1] === "-" ? -sen : sen;
}

/** Sen → "Rp 6.500.000" / "Rp 0,01" (nilai mutlak; tanda disebut kalimatnya). */
export function rpSen(sen: number): string {
  const a = Math.abs(sen);
  const rupiah = Math.floor(a / 100);
  const sisa = a % 100;
  return `Rp ${rupiah.toLocaleString("id-ID")}${sisa === 0 ? "" : `,${String(sisa).padStart(2, "0")}`}`;
}

// ---------------------------------------------------------------------------
// Pilihan pihak lawan pada satu baris mutasi (R2, KTD3)
// ---------------------------------------------------------------------------

export interface PihakLawanTerbaca {
  nama: string;
  jenis: JenisPihakLawan;
  aktif: boolean;
}

/**
 * Vonis pilihan pihak lawan untuk SATU baris kas. `pihak` = baris yang dibaca
 * ulang di server dari unit yang SAMA (`null` = tak ditemukan di unit itu).
 * Mengembalikan pesan yang menyebut perbaikannya, atau `null` bila sah.
 */
export function periksaPihakLawanMutasi(m: {
  categoryLabel: string | null;
  pihakLawanId: string | null | undefined;
  pihak: PihakLawanTerbaca | null;
}): string | null {
  const id = m.pihakLawanId ?? null;
  if (!kategoriPihakLawan(m.categoryLabel)) {
    // Pihak lawan pada baris beban/pendapatan menggeser saldo pihak lawan itu
    // (saldo = −Σ amount barisnya) padahal tak ada hutang/piutang yang lahir.
    return id === null
      ? null
      : "Pihak lawan hanya dipakai untuk kategori Hutang Piutang atau Penyerahan titipan — kosongkan pilihan pihak lawannya.";
  }
  if (id === null) {
    return `Kategori “${m.categoryLabel}” wajib menyebut pihak lawan — pilih pihak lawan yang aktif di unit ini.`;
  }
  if (m.pihak === null) return "Pihak lawan tak ditemukan di unit ini — muat ulang halaman lalu pilih lagi.";
  if (!m.pihak.aktif) {
    return `Pihak lawan “${m.pihak.nama}” sudah nonaktif dan tak bisa dipilih — pilih pihak lawan yang aktif.`;
  }
  if (m.categoryLabel === "Penyerahan titipan" && m.pihak.jenis !== "titipan") {
    return "Penyerahan titipan hanya ke pihak lawan berjenis pemilik titipan — pilih pemilik titipannya.";
  }
  if (m.categoryLabel !== "Penyerahan titipan" && m.pihak.jenis === "titipan") {
    return `“${m.pihak.nama}” adalah pemilik titipan — catat penyerahannya dengan kategori Penyerahan titipan.`;
  }
  return null;
}

/** Pihak lawan AKTIF yang ditawarkan formulir — yang nonaktif tak pernah ditawarkan. */
export interface PilihanPihakLawan {
  id: string;
  nama: string;
  jenis: JenisPihakLawan;
}

/**
 * Pilihan yang sah untuk satu kategori — aturan jenis yang SAMA dengan
 * {@link periksaPihakLawanMutasi}, supaya layar tak menawarkan pilihan yang
 * pasti ditolak server. Server tetap memeriksa ulang.
 */
export function pihakLawanUntuk(
  kategori: string | null | undefined,
  semua: readonly PilihanPihakLawan[],
): PilihanPihakLawan[] {
  if (!kategoriPihakLawan(kategori)) return [];
  return semua.filter((p) => (kategori === "Penyerahan titipan" ? p.jenis === "titipan" : p.jenis !== "titipan"));
}

// ---------------------------------------------------------------------------
// Pecahan (R9, AE6)
// ---------------------------------------------------------------------------

export interface BarisPecahanMasukan {
  /** BERTANDA seperti `cash_ledger`: debet > 0, kredit < 0. */
  amount: number;
  categorySide: SisiKategori | null;
  categoryLabel: string | null;
}

/**
 * Satu mutasi bank dipecah jadi N baris: Σ baris = nominal sumber, **tepat
 * Rp 0** dalam sen bulat. Tiap baris sesisi & setanda dengan jenis mutasinya —
 * pecahan bukan jalan menyelundupkan baris berlawanan arah.
 */
export function periksaPecahan(p: {
  jenis: "debet" | "kredit";
  total: number;
  baris: readonly BarisPecahanMasukan[];
}): string | null {
  if (p.jenis !== "debet" && p.jenis !== "kredit") {
    return "Pecahan hanya untuk mutasi debet atau kredit.";
  }
  const totalSen = rupiahKeSen(p.total);
  if (totalSen === null || !tandaCocok(p.jenis, p.total)) {
    return "Nominal mutasi tak valid: debet positif, kredit negatif, bukan nol, paling banyak dua desimal.";
  }
  if (p.baris.length < 2) {
    return "Pecahan butuh minimal dua baris — satu baris cukup dicatat sebagai mutasi biasa.";
  }
  let jumlah = 0;
  for (const [i, b] of p.baris.entries()) {
    const n = i + 1;
    const sen = rupiahKeSen(b.amount);
    if (sen === null || !tandaCocok(p.jenis, b.amount)) {
      return `Baris ${n}: nominal harus ${p.jenis === "debet" ? "positif" : "negatif"}, bukan nol, paling banyak dua desimal.`;
    }
    if (!b.categoryLabel || b.categoryLabel.trim() === "") return `Baris ${n}: pilih kategorinya.`;
    if (!kategoriCocok(p.jenis, b.categorySide)) {
      return `Baris ${n}: kategori harus sesisi dengan jenis mutasinya (${p.jenis}).`;
    }
    jumlah += sen;
  }
  if (jumlah !== totalSen) {
    return (
      `Jumlah pecahan ${rpSen(jumlah)} tidak sama dengan nominal mutasi ${rpSen(totalSen)} — ` +
      `selisih ${rpSen(jumlah - totalSen)}. Perbaiki baris pecahan sampai selisihnya Rp 0.`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Saldo pembuka per pihak lawan (R7)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function periksaSaldoAwalPihakLawan(s: {
  tanggal: string;
  amount: number;
  sementara: boolean;
  alasan: string;
}): string | null {
  if (!DATE_RE.test(s.tanggal)) return "Tanggal cut-over tak valid — isi tanggal saldo pembuka berlaku.";
  if (rupiahKeSen(s.amount) === null) return "Nominal tak valid — angka rupiah, paling banyak dua desimal.";
  if (s.amount === 0 && !s.sementara) {
    // Sama dengan §10.26 dan CHECK `pihak_lawan_saldo_awal_nol_sementara`.
    return (
      "Saldo pembuka Rp 0 hanya boleh bila ditandai SEMENTARA (angka konfirmasi menyusul) — " +
      "supaya nol tidak terbaca sebagai saldo sungguhan."
    );
  }
  if (s.alasan.trim() === "") return "Alasan wajib diisi: dari mana angka ini berasal.";
  return null;
}

/**
 * Sisi LAWAN dari satu pengisian pasangan unit (R7): piutang unit A ke B
 * sebesar +X adalah hutang unit B ke A sebesar −X. Nol tetap nol (bukan −0,
 * yang `Object.is` bedakan dan JSON tulis "0" — tak berbahaya, tetapi salah).
 */
export function nominalSisiLawan(amount: number): number {
  return amount === 0 ? 0 : -amount;
}

// ---------------------------------------------------------------------------
// Saldo per pihak lawan per tanggal (KTD2)
// ---------------------------------------------------------------------------

export interface MutasiPihakLawan {
  pihakLawanId: string;
  /** Hari buku (`business_date`), 'YYYY-MM-DD'. */
  businessDate: string;
  /** BERTANDA seperti `cash_ledger.amount`, dalam sen. */
  amountSen: number;
  void: boolean;
}

export interface SaldoAwalPihakLawan {
  /** Berlaku pada AWAL hari ini. */
  tanggal: string;
  amountSen: number;
  sementara: boolean;
}

export interface HasilSaldoPihakLawan {
  saldoSen: number;
  /** Baris yang ikut dijumlah. */
  nMutasi: number;
  /**
   * Baris bertanggal SEBELUM saldo pembuka — tidak dijumlah karena sudah termuat
   * di dalamnya (§10.24 butir 2: dihitung dua kali bila dijumlah). Disebut
   * jumlahnya supaya pengecualiannya terlihat, bukan diam.
   */
  nPraSaldoAwal: number;
  saldoAwalBerlaku: boolean;
  sementara: boolean;
}

/**
 * Saldo satu pihak lawan PADA AKHIR hari `per` = saldo pembuka (bila sudah
 * berlaku) + (−Σ amount baris non-void pihak lawan itu dengan business_date
 * ≤ `per`). Positif = piutang.
 */
export function saldoPihakLawan(a: {
  pihakLawanId: string;
  saldoAwal: SaldoAwalPihakLawan | null;
  mutasi: readonly MutasiPihakLawan[];
  per: string;
}): HasilSaldoPihakLawan {
  const awal = a.saldoAwal;
  const berlaku = awal !== null && awal.tanggal <= a.per;
  let saldo = berlaku ? awal.amountSen : 0;
  let n = 0;
  let pra = 0;
  for (const m of a.mutasi) {
    if (m.void || m.pihakLawanId !== a.pihakLawanId || m.businessDate > a.per) continue;
    if (berlaku && m.businessDate < awal.tanggal) {
      pra++;
      continue;
    }
    saldo -= m.amountSen;
    n++;
  }
  return {
    saldoSen: saldo === 0 ? 0 : saldo,
    nMutasi: n,
    nPraSaldoAwal: pra,
    saldoAwalBerlaku: berlaku,
    sementara: berlaku && awal.sementara,
  };
}
