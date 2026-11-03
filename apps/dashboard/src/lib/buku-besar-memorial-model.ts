import { MULAI_BUKU_BESAR, POS, type BarisJurnal } from "./buku-besar-model";
import { KODE_INDUK_BANK, type Pos } from "./pos-model";

/**
 * Masukan Head of Finance ke buku besar — MURNI (rencana 2026-11-02 K6 U9; R8,
 * R9, AE10, KD13, KTD11). Server action (`buku-besar-actions.ts`) dan layar
 * memakai fungsi yang SAMA; server tetap yang memutuskan.
 *
 * ⛔ YANG MENGIKAT:
 *
 * 1. **Tidak ada angka penyeimbang** (R9). Saldo awal yang tidak seimbang
 *    ditolak dengan bedanya disebut; sistem tidak pernah mengisi selisih ke
 *    pos mana pun.
 * 2. **Kas dan bank tidak diketik** (spec-flow I9). 1101, 1102, dan 111x
 *    dibaca dari saldo pembuka rekening (§10.24) — satu angka, satu sumber.
 * 3. **Memorial besar atau yang menyentuh pos kliring menunggu Direksi** (R8,
 *    KD13): > Rp 100.000, atau menyentuh 1103, 1190, 1198, 1199, 5130.
 *    Pengusul tidak pernah menyetujui memorialnya sendiri — juga super admin.
 * 4. **Sen bulat.** Setiap nilai uang bilangan bulat sen.
 */

/** Pos yang memorialnya selalu menunggu persetujuan Direksi (R8). */
export const POS_MEMORIAL_PERSETUJUAN: readonly string[] = [
  POS.BELUM_DISETOR,
  POS.DANA_DALAM_PERJALANAN,
  POS.BELUM_DIPETAKAN,
  POS.BELUM_TERIDENTIFIKASI,
  POS.SELISIH_KAS,
];

/** Memorial bernilai LEBIH dari ini menunggu persetujuan (R8): Rp 100.000. */
export const AMBANG_MEMORIAL_SEN = 10_000_000;

const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Sen → "Rp 1.234.567" (pecahan sen ditampilkan bila ada). */
export function rpSen(sen: number): string {
  const neg = sen < 0;
  const a = Math.abs(sen);
  const rp = Math.floor(a / 100).toLocaleString("id-ID");
  const s = a % 100;
  return `${neg ? "−" : ""}Rp ${rp}${s === 0 ? "" : `,${String(s).padStart(2, "0")}`}`;
}

/** Pos kas & bank: 1101, 1102, dan sub-pos rekening bank (111x). */
export function posKasBank(p: Pos): boolean {
  return p.kode === POS.KAS_BESAR || p.kode === POS.EDC_PENAMPUNGAN || p.kodeInduk === KODE_INDUK_BANK || p.cashAccountId !== null;
}

/** Saldo normal pos ini di sisi debet? Aset & beban debet; pengurang membalik. */
export function normalDebet(p: Pick<Pos, "jenis" | "pengurang">): boolean {
  const debet = p.jenis === "aset" || p.jenis === "beban";
  return p.pengurang ? !debet : debet;
}

/** Nilai yang diketik di sisi normal pos → saldo bertanda (positif = debet). */
export function saldoDariNilaiNormal(p: Pick<Pos, "jenis" | "pengurang">, nilaiSen: number): number {
  return normalDebet(p) ? nilaiSen : -nilaiSen;
}

const bulatSen = (n: number) => Number.isSafeInteger(n);

// ---------------------------------------------------------------------------
// Saldo awal pos (R9, AE10)
// ---------------------------------------------------------------------------

export interface SaldoAwalBaris {
  posKode: string;
  /** Positif = saldo debet, negatif = saldo kredit (0058 keputusan 8). */
  saldoSen: number;
  sumber: "akuntan" | "akun_kas";
}

export type HasilSaldoAwal =
  | { ok: true; baris: SaldoAwalBaris[] }
  | { ok: false; error: string; bedaSen?: number };

/**
 * Periksa saldo awal 30 Sep 2026 seluruh unit sekaligus.
 *
 * `ketik` = isian HoF di sisi normal pos (aset positif, kewajiban/modal positif,
 * pengurang positif); `kas` = saldo pembuka rekening per pos kas/bank, sudah
 * bertanda. Pos neraca saja (kelas 1–3, bukan 3900): laba Jan–Sep sudah ada di
 * 3200 Laba Ditahan dari akuntan.
 */
/**
 * Pos yang saldo awal NOL-nya bermakna: P23 hanya menilai ulang 1131/1132 bila
 * saldo awalnya diketahui (baris ada), jadi nol yang diisi HoF disimpan, bukan
 * dibuang seperti nol pos lain (tinjauan PR #448).
 */
export const SALDO_NOL_DIPERTAHANKAN: ReadonlySet<string> = new Set(["1131", "1132"]);

export function periksaSaldoAwal(i: {
  ketik: readonly { posKode: string; nilaiSen: number }[];
  kas: readonly { posKode: string; saldoSen: number }[];
  daftar: readonly Pos[];
}): HasilSaldoAwal {
  const sudah = new Set<string>();
  const baris: SaldoAwalBaris[] = [];
  for (const k of i.kas) {
    if (k.saldoSen !== 0) baris.push({ posKode: k.posKode, saldoSen: k.saldoSen, sumber: "akun_kas" });
  }
  for (const k of i.ketik) {
    const p = i.daftar.find((x) => x.kode === k.posKode);
    if (!p) return { ok: false, error: `Pos ${k.posKode} tidak dikenal di unit ini.` };
    if (p.induk) return { ok: false, error: `Pos ${p.kode} ${p.nama} adalah pos induk — isi sub-posnya.` };
    if (p.jenis === "pendapatan" || p.jenis === "beban") {
      return { ok: false, error: `Pos ${p.kode} ${p.nama} adalah pos laba-rugi — saldo awal hanya untuk pos neraca. Laba sampai 30 Sep masuk 3200 Laba Ditahan.` };
    }
    if (p.kode === "3900") return { ok: false, error: "Pos 3900 Laba Tahun Berjalan dihitung, tidak diisi." };
    if (posKasBank(p)) {
      return { ok: false, error: `Pos ${p.kode} ${p.nama} dibaca dari saldo pembuka rekening di Kelola akun kas — tidak diketik di sini.` };
    }
    if (!bulatSen(k.nilaiSen)) return { ok: false, error: `Nilai pos ${p.kode} tidak sah.` };
    if (sudah.has(p.kode)) return { ok: false, error: `Pos ${p.kode} diisi dua kali.` };
    sudah.add(p.kode);
    const saldoSen = saldoDariNilaiNormal(p, k.nilaiSen);
    if (saldoSen !== 0 || SALDO_NOL_DIPERTAHANKAN.has(p.kode)) baris.push({ posKode: p.kode, saldoSen, sumber: "akuntan" });
  }
  baris.sort((a, b) => a.posKode.localeCompare(b.posKode));

  const aset = baris.filter((b) => b.posKode.startsWith("1")).reduce((s, b) => s + b.saldoSen, 0);
  const kewajibanModal = -baris.filter((b) => !b.posKode.startsWith("1")).reduce((s, b) => s + b.saldoSen, 0);
  const beda = aset - kewajibanModal;
  if (beda !== 0) {
    return {
      ok: false,
      bedaSen: beda,
      error:
        `Saldo awal tidak seimbang: aset ${rpSen(aset)} vs kewajiban + modal ${rpSen(kewajibanModal)} — ` +
        `beda ${rpSen(Math.abs(beda))}. Sistem tidak menambah angka penyeimbang; periksa angka dari akuntan.`,
    };
  }
  return { ok: true, baris };
}

// ---------------------------------------------------------------------------
// Jurnal memorial (R8, KD13, KTD11)
// ---------------------------------------------------------------------------

export interface MasukanMemorial {
  tanggal: string;
  alasan: string;
  bukti: string;
  baris: readonly BarisJurnal[];
}

export type HasilMemorial =
  | { ok: true; baris: BarisJurnal[]; totalSen: number; status: "aktif" | "menunggu"; sebabMenunggu: string | null }
  | { ok: false; error: string };

/** Mengapa memorial ini menunggu persetujuan — `null` = langsung terposting. */
export function sebabPersetujuan(baris: readonly BarisJurnal[]): string | null {
  const total = baris.reduce((s, b) => s + b.debetSen, 0);
  const kliring = [...new Set(baris.map((b) => b.posKode).filter((k) => POS_MEMORIAL_PERSETUJUAN.includes(k)))];
  if (kliring.length > 0) return `menyentuh pos ${kliring.join(", ")}`;
  if (total > AMBANG_MEMORIAL_SEN) return `bernilai lebih dari ${rpSen(AMBANG_MEMORIAL_SEN)}`;
  return null;
}

export function periksaMemorial(m: MasukanMemorial, daftar: readonly Pos[]): HasilMemorial {
  if (!TANGGAL_RE.test(m.tanggal)) return { ok: false, error: "Tanggal memorial harus YYYY-MM-DD." };
  if (m.tanggal < MULAI_BUKU_BESAR) return { ok: false, error: `Buku besar dimulai ${MULAI_BUKU_BESAR} — saldo sebelumnya diisi di Saldo awal.` };
  if (m.alasan.trim() === "") return { ok: false, error: "Alasan wajib diisi." };
  if (m.bukti.trim() === "") return { ok: false, error: "Bukti wajib diisi (nomor dokumen atau tautan lampiran)." };
  if (m.baris.length < 2) return { ok: false, error: "Jurnal memorial butuh minimal dua baris." };
  for (const b of m.baris) {
    const p = daftar.find((x) => x.kode === b.posKode);
    if (!p) return { ok: false, error: `Pos ${b.posKode} tidak dikenal di unit ini.` };
    if (p.induk) return { ok: false, error: `Pos ${p.kode} ${p.nama} adalah pos induk — jurnal memakai sub-posnya.` };
    if (p.kode === "3900") return { ok: false, error: "Pos 3900 Laba Tahun Berjalan dihitung dari kelas 4 dan 5 — tidak bisa dijurnal." };
    if (!bulatSen(b.debetSen) || !bulatSen(b.kreditSen) || b.debetSen < 0 || b.kreditSen < 0) {
      return { ok: false, error: `Nominal pos ${p.kode} tidak sah.` };
    }
    if ((b.debetSen > 0) === (b.kreditSen > 0)) {
      return { ok: false, error: `Baris pos ${p.kode} harus berisi tepat satu sisi: debet atau kredit.` };
    }
  }
  const d = m.baris.reduce((s, b) => s + b.debetSen, 0);
  const k = m.baris.reduce((s, b) => s + b.kreditSen, 0);
  if (d !== k) return { ok: false, error: `Jurnal tidak seimbang: debet ${rpSen(d)} vs kredit ${rpSen(k)} — beda ${rpSen(Math.abs(d - k))}.` };
  const sebab = sebabPersetujuan(m.baris);
  return {
    ok: true,
    baris: m.baris.map((b) => ({ posKode: b.posKode, debetSen: b.debetSen, kreditSen: b.kreditSen })),
    totalSen: d,
    status: sebab === null ? "aktif" : "menunggu",
    sebabMenunggu: sebab,
  };
}

/** Pembatalan memorial = pembalikan: setiap baris berganti sisi (R8). */
export function barisPembalikan(baris: readonly BarisJurnal[]): BarisJurnal[] {
  return baris.map((b) => ({ posKode: b.posKode, debetSen: b.kreditSen, kreditSen: b.debetSen }));
}

/**
 * Boleh menyetujui memorial ini? `null` = boleh (R8, KD13). `bolehSetujui` =
 * `canSetujuiMemorial` aktor, dihitung pemanggil di server.
 */
export function periksaPersetujuan(
  j: { status: string; diusulkanOleh: number | null },
  aktor: { userId: number; bolehSetujui: boolean },
): string | null {
  if (!aktor.bolehSetujui) return "Hanya Direksi yang boleh menyetujui jurnal memorial.";
  if (j.status !== "menunggu") return "Jurnal ini tidak menunggu persetujuan — muat ulang halaman.";
  if (j.diusulkanOleh !== null && j.diusulkanOleh === aktor.userId) {
    return "Pengusul tidak boleh menyetujui jurnal memorialnya sendiri.";
  }
  return null;
}
