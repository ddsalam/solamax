/**
 * Impor rekening koran — bagian MURNI (rencana 2026-10-29 U9; R17–R19, R22;
 * KTD13). Tanpa I/O, tanpa DB: dipakai server action, kueri halaman, dan uji.
 */
import { bulanSah } from "./bulan";
import type { Ketidakcocokan } from "./impor-bank-parser";

/**
 * Batas ukuran berkas unggahan. E-statement nyata 30–75 KB; `bodySizeLimit`
 * server action (`next.config.mjs`) = "1mb" = 1.048.576 byte untuk SELURUH
 * badan multipart, jadi berkasnya dibatasi sedikit di bawahnya. Komponen unggah
 * memeriksanya SEBELUM mengirim — berkas lebih besar dari `bodySizeLimit`
 * ditolak Next sebelum aksi berjalan, dengan galat yang tak berpesan.
 */
export const MAKS_BERKAS_BYTE = 1_000_000;

/** `null` = boleh dibaca; selainnya pesan penolakan untuk pengguna. */
export function periksaBerkas(ukuran: number): string | null {
  if (ukuran <= 0) return "Berkas kosong — pilih e-statement PDF dari BCA.";
  if (ukuran > MAKS_BERKAS_BYTE) {
    return (
      `Berkas ${(ukuran / 1_000_000).toFixed(1).replace(".", ",")} MB melebihi batas 1 MB. ` +
      "E-statement BCA satu bulan biasanya 30–75 KB — pastikan yang diunggah e-statement PDF dari BCA, bukan hasil pindai."
    );
  }
  return null;
}

/**
 * Digit saja, nol di depan dibuang (KTD13). Kepala e-statement mencetak 10
 * digit ("5125036811"); sumber lain bisa berawalan nol ("05125036811").
 */
export function normalisasiNomorRekening(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "").replace(/^0+/, "");
}

/** Kosong / nol semua TIDAK PERNAH sama dengan apa pun — fail-closed. */
export function nomorRekeningSama(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalisasiNomorRekening(a);
  return x !== "" && x === normalisasiNomorRekening(b);
}

/** `YYYY-MM` ⇒ `YYYY-MM-01`. */
export function periodeAwal(periode: string): string {
  if (!bulanSah(periode)) throw new Error(`Periode harus YYYY-MM, diterima "${periode}".`);
  return `${periode}-01`;
}

/** Bulan `awal`..`akhir` inklusif (`YYYY-MM`); kosong bila awal > akhir. */
export function daftarBulan(awal: string, akhir: string): string[] {
  periodeAwal(awal);
  periodeAwal(akhir);
  const hasil: string[] = [];
  let [y, m] = awal.split("-").map(Number) as [number, number];
  const [ya, ma] = akhir.split("-").map(Number) as [number, number];
  while (y < ya || (y === ya && m <= ma)) {
    hasil.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return hasil;
}

// ---------------------------------------------------------------------------
// R18 — saldo awal rekening koran vs saldo buku hari sebelum periode
// ---------------------------------------------------------------------------

/**
 * Saldo buku rekening itu pada AWAL hari pertama periode — dihitung MENURUT
 * TANGGAL ASAL (baris bulan lalu yang dibukukan maju dihitung pada tanggal
 * asalnya), dari saldo pembuka rekening (`saldo_awal`, §10.24). Lihat
 * `SQL_SALDO_BUKU_AWAL` di `impor-bank-queries.ts`.
 */
export interface SaldoBukuAwal {
  /** Hari saldo pembuka rekening (saldo berlaku pada AWAL hari ini). */
  cutOver: string;
  saldoSen: number;
  /** §10.26 — saldo pembuka rekening masih sementara. */
  sementara: boolean;
}

export type PerbandinganSaldoAwal =
  | { status: "cocok" | "selisih"; bukuSen: number; /** rekening koran − buku */ selisihSen: number; sementara: boolean }
  /** Rekening belum punya saldo pembuka — tak ada buku untuk dibandingkan. */
  | { status: "tanpa-saldo-pembuka" }
  /** Periode dimulai sebelum saldo pembuka rekening (R22) — buku belum ada. */
  | { status: "sebelum-cut-over"; cutOver: string };

export function bandingkanSaldoAwal(m: {
  periode: string;
  saldoAwalSen: number;
  buku: SaldoBukuAwal | null;
  /**
   * Cut-over terawal UNIT (§10.26) — dipakai hanya bila rekening belum punya
   * saldo pembuka sendiri, supaya hasil ini sejalan dengan kepala baris matriks
   * dan penanda `pra_cutover` (keduanya jatuh ke cut-over unit, `SQL_CUT_OVER`).
   */
  cutOverUnit?: string | null;
}): PerbandinganSaldoAwal {
  if (m.buku === null) {
    if (m.cutOverUnit && m.cutOverUnit > periodeAwal(m.periode)) return { status: "sebelum-cut-over", cutOver: m.cutOverUnit };
    return { status: "tanpa-saldo-pembuka" };
  }
  if (m.buku.cutOver > periodeAwal(m.periode)) return { status: "sebelum-cut-over", cutOver: m.buku.cutOver };
  const selisihSen = m.saldoAwalSen - m.buku.saldoSen;
  return { status: selisihSen === 0 ? "cocok" : "selisih", bukuSen: m.buku.saldoSen, selisihSen, sementara: m.buku.sementara };
}

// ---------------------------------------------------------------------------
// Hasil unggah — empat keluaran yang dibedakan layar (U9 butir 6)
// ---------------------------------------------------------------------------

export type SebabTolak =
  /** Bukan peran Keuangan (atau HoF, §10.12). */
  | "wewenang"
  /** Kosong, terlalu besar, bukan PDF, pdftotext gagal. */
  | "berkas"
  /** Teks bukan e-statement BCA yang dikenali (U8 `format`). */
  | "format"
  /** R18 — rekening tak terdaftar di unit ini / nomor tak cocok / bukan BCA. */
  | "rekening-salah"
  /** Berkas BERBEDA untuk (rekening, bulan) yang sudah aktif — HoF menarik dulu. */
  | "periode-aktif"
  /** Bulan berkas sudah ditutup (`tutup_bulan`) — tak dibuka kembali (§10.43). */
  | "bulan-tertutup"
  /** Galat tak terduga saat menulis — transaksi dibatalkan, tak ada yang tersimpan. */
  | "galat";

export type HasilCocokSesudahUnggah =
  | { status: "selesai"; nOtomatis: number; nBanyak: number; nTanpa: number }
  | { status: "gagal"; pesan: string };

export type HasilUnggah =
  | {
      status: "diterima";
      rekeningKoranId: string;
      periode: string;
      nBaris: number;
      /** R22 — baris bertanggal sebelum cut-over: disimpan, tak pernah dibukukan. */
      nPraCutover: number;
      nCr: number;
      nDb: number;
      saldoAwal: PerbandinganSaldoAwal;
      /**
       * U10 — cocok otomatis yang dijalankan SESUDAH impor COMMIT. Gagalnya tak
       * membatalkan impor (baris tetap tersimpan, terbuka); pesannya dilaporkan.
       */
      cocok: HasilCocokSesudahUnggah;
    }
  | { status: "sudah-ada"; rekeningKoranId: string; periode: string; nBaris: number; nPraCutover: number }
  | { status: "ditolak-kaki"; pesan: string; ketidakcocokan: Ketidakcocokan[] }
  | { status: "ditolak"; sebab: SebabTolak; pesan: string };

// ---------------------------------------------------------------------------
// Sel matriks rekening × bulan
// ---------------------------------------------------------------------------

export interface RingkasRekeningKoran {
  id: string;
  status: "aktif" | "ditarik";
  nBaris: number;
  nPraCutover: number;
  /** Baris (bukan pra-cut-over) yang berada di kelompok cocok AKTIF (U10). */
  nCocok: number;
  uploadedAt: string;
}

export type SelMatriks =
  | { status: "belum" }
  /**
   * `nTerbuka` = baris yang belum di kelompok cocok AKTIF dan bukan pra-cut-over
   * (pra-cut-over tak pernah dicocokkan, R22): N − pra-cut-over − tercocok.
   */
  | { status: "diunggah"; id: string; nBaris: number; nTerbuka: number }
  | { status: "ditarik"; id: string };

/** Rekening koran satu (rekening, bulan) — paling banyak satu yang aktif (0051). */
export function selMatriks(rows: readonly RingkasRekeningKoran[]): SelMatriks {
  const aktif = rows.find((r) => r.status === "aktif");
  if (aktif) return { status: "diunggah", id: aktif.id, nBaris: aktif.nBaris, nTerbuka: aktif.nBaris - aktif.nPraCutover - aktif.nCocok };
  const terakhir = [...rows].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
  return terakhir ? { status: "ditarik", id: terakhir.id } : { status: "belum" };
}
