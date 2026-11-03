import { addDays } from "./periods";
import { geserBulan, hariTerakhir } from "./bulan";
import { MULAI_BUKU_BESAR, POS } from "./buku-besar-model";

/**
 * PEMERIKSAAN BUKU BESAR saat tutup bulan — MURNI (rencana 2026-11-02 K6 U11;
 * R33, R11, AE9; KTD3, KTD5). Tanpa I/O. Bacaannya di `tutup-bulan-queries.ts`
 * (`bacaBahanBukuBesar`), penggabungnya `periksaTutupBulan` — layar dan aksi
 * tutup bulan memakai fungsi yang SAMA.
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Aktif sejak bulan pertama bersaldo awal lengkap** — lengkap = minimal
 *    satu baris `saldo_awal_pos` aktif DAN Σ saldo bertanda = 0 (debet =
 *    kredit; kas dan bank ikut sebagai baris `sumber = 'akun_kas'`). Sekali
 *    unit punya bulan yang ditutup dengan buku besar, pemeriksaan TETAP aktif
 *    walau saldo awal kemudian tak lengkap (mis. baris di-void untuk diketik
 *    ulang) — ia lalu MENOLAK lewat cek saldo awal, bukan diam-diam dilewati.
 * 2. **Saldo menurut tanggal efektif** — saldo awal pos + jurnal aktif (bukan
 *    jenis `saldo_awal`, keduanya tak boleh dijumlah) bertanggal efektif ≤
 *    akhir bulan. Pembacanya yang menyaring; di sini hanya angka.
 * 3. **Tidak ada angka penyeimbang.** Setiap cek yang gagal menamai pos,
 *    rekening, atau butirnya; tak ada yang dinolkan otomatis.
 * 4. **Butir dalam perjalanan (1103, 1190)** — baris jurnal pos itu bertanggal
 *    efektif di bulan ini yang ditiadakan TEPAT (nominal sama, sisi
 *    berlawanan) oleh baris jurnal pos yang sama bertanggal efektif 1–3 hari
 *    pertama bulan berikutnya. Pasangan satu-satu, baris bulan ini yang paling
 *    akhir lebih dulu. Lolos HANYA bila jumlah butir = saldo pos itu; sisanya
 *    menolak. Pelunasan sebagian (satu baris dilunasi beberapa baris) tidak
 *    dikenali — menolak, gagal tertutup.
 * 5. **Harga beli kosong (R11)** dikenali dari temuan pembentukan ulang —
 *    U8 tidak menyimpan temuan. `null` = belum diperiksa (halaman tidak
 *    membentuk ulang); tidak menahan, tetapi aksi tutup bulan selalu mengisi.
 *
 * Nominal dalam SEN bulat; saldo bertanda: positif = debet.
 */

/** Pos kliring yang wajib Rp 0 tanpa kecuali. */
export const POS_WAJIB_NOL = [POS.BELUM_DIPETAKAN, POS.BELUM_TERIDENTIFIKASI] as const;
/** Pos kliring yang boleh bersisa butir dalam perjalanan. */
export const POS_PERJALANAN = [POS.BELUM_DISETOR, POS.DANA_DALAM_PERJALANAN] as const;
/** Pasangan butir dalam perjalanan jatuh paling lambat hari ke-N bulan berikutnya. */
export const HARI_PERJALANAN = 3;

const BULAN_MULAI = MULAI_BUKU_BESAR.slice(0, 7);

// ---------------------------------------------------------------------------
// Masukan
// ---------------------------------------------------------------------------

export interface RingkasSaldoAwalPos {
  /** Baris `saldo_awal_pos` aktif (tidak void) unit itu. */
  jumlahBaris: number;
  /** Σ saldo bertanda — 0 = seimbang. */
  totalSen: number;
}

/** Net satu jurnal pada satu pos kliring (1103/1190). */
export interface BarisKliring {
  jurnalId: string;
  posKode: string;
  tanggalEfektif: string;
  /** Bertanda: debet > 0. */
  netSen: number;
  keterangan: string;
}

/** Sub-pos bank (pos_unit bertaut rekening) + saldo akhir rekening koran AKTIF bulan itu. */
export interface RekeningBankBukuBesar {
  posKode: string;
  accountId: string;
  nama: string;
  /** `null` = tak ada rekening koran aktif bulan itu. */
  saldoRekeningKoranSen: number | null;
}

export interface TemuanHargaBeli {
  tanggal: string;
  produk: string | null;
  pesan: string;
}

export interface MasukanCekBukuBesar {
  /** `YYYY-MM`. */
  bulan: string;
  saldoAwal: RingkasSaldoAwalPos;
  /** Unit sudah punya bulan yang ditutup dengan buku besar (`tutup_bulan.buku_besar`). */
  adaTutupBukuBesar: boolean;
  /** Saldo per pos s.d. akhir bulan menurut tanggal efektif, termasuk saldo awal pos. */
  saldoPos: readonly { posKode: string; saldoSen: number }[];
  bank: readonly RekeningBankBukuBesar[];
  /** Baris pos 1103/1190 bertanggal efektif di bulan ini s.d. hari ke-3 bulan berikutnya. */
  kliring: readonly BarisKliring[];
  /** Temuan `harga_beli_kosong` hari-hari bulan ini; `null` = belum diperiksa. */
  temuanHargaBeli: readonly TemuanHargaBeli[] | null;
}

// ---------------------------------------------------------------------------
// Vonis
// ---------------------------------------------------------------------------

export interface ButirPerjalanan extends BarisKliring {
  /** Tanggal efektif kaki pasangannya di bulan berikutnya. */
  tanggalPasangan: string;
}

export interface CekBukuBesar {
  saldoAwalPos: { ok: boolean; jumlahBaris: number; totalSen: number };
  neraca: { ok: boolean; debetSen: number; kreditSen: number };
  kliringNol: { ok: boolean; pos: { posKode: string; saldoSen: number }[] };
  perjalanan: {
    ok: boolean;
    pos: { posKode: string; saldoSen: number; butir: ButirPerjalanan[]; sisaSen: number }[];
  };
  bank: {
    ok: boolean;
    rekening: (RekeningBankBukuBesar & { saldoBukuSen: number; ok: boolean })[];
  };
  hargaBeli: { ok: boolean; diperiksa: boolean; temuan: TemuanHargaBeli[] };
}

export type VonisCekBukuBesar =
  | { aktif: false; alasanTidakAktif: string }
  | { aktif: true; boleh: boolean; cek: CekBukuBesar; alasan: string[] };

export const ALASAN_TIDAK_AKTIF = "Pemeriksaan buku besar belum aktif — saldo awal belum lengkap.";

export function saldoAwalLengkap(s: RingkasSaldoAwalPos): boolean {
  return s.jumlahBaris > 0 && s.totalSen === 0;
}

/** Aturan aktif (butir 1). */
export function bukuBesarAktif(m: Pick<MasukanCekBukuBesar, "bulan" | "saldoAwal" | "adaTutupBukuBesar">): boolean {
  return m.bulan >= BULAN_MULAI && (saldoAwalLengkap(m.saldoAwal) || m.adaTutupBukuBesar);
}

const rp = (sen: number): string =>
  `Rp ${(Math.abs(sen) / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}${sen < 0 ? " (kredit)" : ""}`;

/** Butir 4 — pasangan satu-satu, baris bulan ini yang paling akhir lebih dulu. */
function butirPerjalanan(
  posKode: string,
  kliring: readonly BarisKliring[],
  awal: string,
  akhir: string,
  batas: string,
): ButirPerjalanan[] {
  const pos = kliring.filter((b) => b.posKode === posKode && b.netSen !== 0);
  const bulanIni = pos
    .filter((b) => b.tanggalEfektif >= awal && b.tanggalEfektif <= akhir)
    .sort((a, b) => b.tanggalEfektif.localeCompare(a.tanggalEfektif) || a.jurnalId.localeCompare(b.jurnalId));
  const pasangan = pos
    .filter((b) => b.tanggalEfektif > akhir && b.tanggalEfektif <= batas)
    .sort((a, b) => a.tanggalEfektif.localeCompare(b.tanggalEfektif) || a.jurnalId.localeCompare(b.jurnalId));
  const terpakai = new Set<string>();
  const butir: ButirPerjalanan[] = [];
  for (const p of pasangan) {
    const c = bulanIni.find((b) => !terpakai.has(b.jurnalId) && b.netSen === -p.netSen);
    if (!c) continue;
    terpakai.add(c.jurnalId);
    butir.push({ ...c, tanggalPasangan: p.tanggalEfektif });
  }
  return butir.sort((a, b) => a.tanggalEfektif.localeCompare(b.tanggalEfektif) || a.jurnalId.localeCompare(b.jurnalId));
}

export function periksaBukuBesar(m: MasukanCekBukuBesar): VonisCekBukuBesar {
  if (!bukuBesarAktif(m)) return { aktif: false, alasanTidakAktif: ALASAN_TIDAK_AKTIF };

  const akhir = hariTerakhir(m.bulan); // melempar bila bulan tak sah
  const awal = `${m.bulan}-01`;
  const batas = addDays(`${geserBulan(m.bulan, 1)}-01`, HARI_PERJALANAN - 1);
  const saldo = new Map<string, number>();
  for (const s of m.saldoPos) saldo.set(s.posKode, (saldo.get(s.posKode) ?? 0) + s.saldoSen);
  const saldoDari = (kode: string) => saldo.get(kode) ?? 0;

  // Saldo awal
  const cekSaldoAwal = { ok: saldoAwalLengkap(m.saldoAwal), ...m.saldoAwal };

  // (a) Neraca saldo
  let debetSen = 0;
  let kreditSen = 0;
  for (const v of saldo.values()) {
    if (v > 0) debetSen += v;
    else kreditSen -= v;
  }
  const neraca = { ok: debetSen === kreditSen, debetSen, kreditSen };

  // (b) 1198, 1199
  const nol = POS_WAJIB_NOL.map((posKode) => ({ posKode, saldoSen: saldoDari(posKode) }));
  const kliringNol = { ok: nol.every((p) => p.saldoSen === 0), pos: nol };

  // (c) 1103, 1190 — kecuali butir dalam perjalanan
  const jalan = POS_PERJALANAN.map((posKode) => {
    const saldoSen = saldoDari(posKode);
    const butir = saldoSen === 0 ? [] : butirPerjalanan(posKode, m.kliring, awal, akhir, batas);
    const sisaSen = saldoSen - butir.reduce((s, b) => s + b.netSen, 0);
    return { posKode, saldoSen, butir, sisaSen };
  });
  const perjalanan = { ok: jalan.every((p) => p.sisaSen === 0), pos: jalan };

  // (d) Sub-pos bank = saldo akhir rekening koran (AE9)
  const rekening = m.bank.map((r) => {
    const saldoBukuSen = saldoDari(r.posKode);
    const ok = r.saldoRekeningKoranSen === null ? saldoBukuSen === 0 : saldoBukuSen === r.saldoRekeningKoranSen;
    return { ...r, saldoBukuSen, ok };
  });
  const bank = { ok: rekening.every((r) => r.ok), rekening };

  // (e) Harga beli belum diisi (R11)
  const temuan = m.temuanHargaBeli === null ? [] : [...m.temuanHargaBeli].sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const hargaBeli = { ok: temuan.length === 0, diperiksa: m.temuanHargaBeli !== null, temuan };

  const alasan: string[] = [];
  if (!cekSaldoAwal.ok) {
    alasan.push(
      m.saldoAwal.jumlahBaris === 0
        ? "Saldo awal pos kosong padahal buku besar sudah berlaku untuk unit ini."
        : `Saldo awal pos tidak seimbang (beda ${rp(m.saldoAwal.totalSen)}).`,
    );
  }
  if (!neraca.ok) {
    alasan.push(`Neraca saldo buku besar tidak seimbang: debet ${rp(debetSen)}, kredit ${rp(kreditSen)} (beda ${rp(Math.abs(debetSen - kreditSen))}).`);
  }
  for (const p of nol) if (p.saldoSen !== 0) alasan.push(`Pos ${p.posKode} belum Rp 0: ${rp(p.saldoSen)}.`);
  for (const p of jalan) {
    if (p.sisaSen === 0) continue;
    alasan.push(
      `Pos ${p.posKode} bersisa ${rp(p.sisaSen)} yang bukan butir dalam perjalanan` +
        (p.butir.length > 0 ? ` (di luar ${p.butir.length} butir dalam perjalanan).` : "."),
    );
  }
  for (const r of rekening) {
    if (r.ok) continue;
    alasan.push(
      r.saldoRekeningKoranSen === null
        ? `Sub-pos ${r.posKode} ${r.nama} bersaldo ${rp(r.saldoBukuSen)} tanpa rekening koran aktif bulan ini.`
        : `Saldo sub-pos ${r.posKode} ${r.nama} di buku besar ${rp(r.saldoBukuSen)}, rekening koran ${rp(r.saldoRekeningKoranSen)}.`,
    );
  }
  if (!hargaBeli.ok) {
    const isi = temuan.map((t) => `${t.produk ?? "produk"} ${t.tanggal}`);
    alasan.push(`Harga beli belum diisi: ${isi.join(", ")} — HPP dan persediaan tidak terposting (R11).`);
  }

  return {
    aktif: true,
    boleh: alasan.length === 0,
    cek: { saldoAwalPos: cekSaldoAwal, neraca, kliringNol, perjalanan, bank, hargaBeli },
    alasan,
  };
}
