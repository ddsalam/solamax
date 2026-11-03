/**
 * Daftar pos (COA empat digit) — MURNI. Rencana 2026-11-02 K6 U1 (R1–R5,
 * KTD1, KTD2).
 *
 * Sumber kebenaran daftarnya adalah migrasi 0056: `app.pos` (Tabel Pos,
 * global), `app.pos_unit` (sub-pos milik satu unit: rekening bank 1111–1119
 * dan sub-pos tambahan HoF), `app.pos_kode_lama` (kode lama → pos baru).
 * Berkas ini tidak menyalin daftarnya — uji kelengkapan membaca seed migrasi
 * langsung (pola keuangan-sisi-kas).
 *
 * ⛔ Kode lama tidak ditulis ulang di baris tersimpan (KTD2). Baris lama tetap
 * berkode 6-xxxx dan diterjemahkan lewat {@link posUntukKode} saat dibaca.
 */

export type JenisPos = "aset" | "kewajiban" | "modal" | "pendapatan" | "beban";

export interface Pos {
  /** `app.pos_unit.id` untuk sub-pos unit; `null` untuk pos daftar resmi. */
  id: string | null;
  kode: string;
  nama: string;
  jenis: JenisPos;
  /** Pos induk hanya menjumlahkan sub-posnya — jurnal tak boleh memakainya. */
  induk: boolean;
  kodeInduk: string | null;
  /** Pos pengurang (kontra): 1590, 4110. */
  pengurang: boolean;
  /** Wajib Rp 0 saat tutup bulan (R33). */
  kliring: boolean;
  /** Hanya diisi sistem. */
  sistem: boolean;
  /** `null` = pos daftar resmi (berlaku semua unit). */
  unitId: number | null;
  /** Hanya sub-pos bank: rekening yang diwakilinya (R5). */
  cashAccountId: string | null;
}

/** Induk sub-pos bank. Sub-posnya lahir dari rekening, tidak diketik (R5). */
export const KODE_INDUK_BANK = "1110";

export const LABEL_JENIS: Record<JenisPos, string> = {
  aset: "aset",
  kewajiban: "kewajiban",
  modal: "modal",
  pendapatan: "pendapatan",
  beban: "beban",
};

export const LABEL_KELAS: Record<string, string> = {
  "1": "ASET (Harta)",
  "2": "KEWAJIBAN (Hutang)",
  "3": "MODAL (Ekuitas)",
  "4": "PENDAPATAN",
  "5": "BEBAN / BIAYA",
};

const KODE_RE = /^\d{4}$/;

/**
 * Pos untuk sebuah kode tersimpan: kode empat digit dipakai apa adanya, kode
 * lama (6-xxxx, 7-1100, 8-1000, 3-9100, 1-1800) diterjemahkan lewat
 * `pos_kode_lama`. `daftar` = pos resmi + sub-pos SATU unit. Tak dikenal ⇒ `null`.
 */
export function posUntukKode(
  kode: string | null,
  daftar: readonly Pos[],
  kodeLama: ReadonlyMap<string, string>,
): Pos | null {
  if (kode === null) return null;
  const k = kode.trim();
  const target = KODE_RE.test(k) ? k : kodeLama.get(k);
  if (target === undefined) return null;
  return daftar.find((p) => p.kode === target) ?? null;
}

/** Boleh dipakai sebagai pos jurnal? `null` = boleh. */
export function periksaPosJurnal(pos: Pos | null | undefined): string | null {
  if (!pos) return "Pos tidak dikenal — pilih dari daftar pos.";
  if (pos.induk) return `Pos ${pos.kode} ${pos.nama} adalah pos induk — jurnal memakai sub-posnya.`;
  return null;
}

/** Rujukan yang menahan penghapusan (R4; temuan spec-flow M6). */
export interface RujukanPos {
  /** Baris peta kategori → pos. */
  peta: number;
  /** Jurnal — atau catatan sumber yang sudah menyimpan kode pos ini. */
  jurnal: number;
  /** Baris saldo awal pos. */
  saldoAwal: number;
}

/**
 * Boleh menghapus pos ini? Hanya sub-pos unit yang diketik HoF, dan hanya bila
 * tak satu pun peta, jurnal, atau saldo awal merujuknya. `null` = boleh.
 */
export function periksaHapusPos(pos: Pos, r: RujukanPos): string | null {
  if (pos.unitId === null) return `Pos ${pos.kode} termasuk daftar pos resmi — tidak bisa dihapus.`;
  if (pos.cashAccountId !== null) {
    return `Sub-pos ${pos.kode} mewakili rekening bank — ia mengikuti rekeningnya di Kelola akun kas, tidak dihapus di sini.`;
  }
  const sebab: string[] = [];
  if (r.peta > 0) sebab.push(`${r.peta} baris peta kategori`);
  if (r.jurnal > 0) sebab.push(`${r.jurnal} jurnal/catatan`);
  if (r.saldoAwal > 0) sebab.push(`${r.saldoAwal} saldo awal`);
  if (sebab.length > 0) return `Pos ${pos.kode} masih dirujuk ${sebab.join(", ")} — tidak bisa dihapus.`;
  return null;
}

/** Sub-pos baru dari HoF (R4). `daftar` = pos resmi + sub-pos unit itu. `null` = boleh. */
export function periksaSubPosBaru(
  input: { kodeInduk: string; kode: string; nama: string },
  daftar: readonly Pos[],
): string | null {
  const kode = input.kode.trim();
  if (input.nama.trim() === "") return "Nama sub-pos wajib diisi.";
  if (!KODE_RE.test(kode)) return "Kode sub-pos harus empat digit angka.";
  const induk = daftar.find((p) => p.unitId === null && p.kode === input.kodeInduk);
  if (!induk || !induk.induk) {
    const pilihan = daftar
      .filter((p) => p.unitId === null && p.induk && p.kode !== KODE_INDUK_BANK)
      .map((p) => p.kode)
      .join(", ");
    return `Sub-pos hanya bisa dibuat di bawah pos induk (${pilihan}).`;
  }
  if (induk.kode === KODE_INDUK_BANK) {
    return "Sub-pos bank lahir otomatis dari rekening di Kelola akun kas (R5) — tidak diketik di sini.";
  }
  const dasar = Number(induk.kode);
  const n = Number(kode);
  if (n < dasar + 1 || n > dasar + 9) {
    return `Kode sub-pos di bawah ${induk.kode} harus ${dasar + 1}–${dasar + 9}.`;
  }
  if (daftar.some((p) => p.kode === kode)) return `Kode ${kode} sudah dipakai.`;
  return null;
}

/**
 * Perubahan peta kategori operasional → pos (R3, R4). Peta berlaku untuk SEMUA
 * unit (bagan seragam, keputusan B1), jadi tujuannya pos daftar resmi berjenis
 * beban yang boleh dijurnal dan tidak diisi sistem. `null` = boleh.
 */
export function periksaPetaBaru(
  input: { kategori: string; kodePos: string },
  daftar: readonly Pos[],
  kategoriSah: readonly string[],
): string | null {
  if (!kategoriSah.includes(input.kategori)) return "Kategori operasional tidak dikenal — pilih dari daftar.";
  const pos = daftar.find((p) => p.unitId === null && p.kode === input.kodePos);
  if (!pos) return `Pos ${input.kodePos} tidak dikenal — pilih dari daftar pos resmi.`;
  if (pos.jenis !== "beban") return "Kategori operasional hanya bisa dipetakan ke pos beban (5xxx).";
  const jurnal = periksaPosJurnal(pos);
  if (jurnal !== null) return jurnal;
  if (pos.sistem) return `Pos ${pos.kode} hanya diisi sistem — pilih pos beban lain.`;
  return null;
}

export interface KelengkapanPeta {
  tanpaPos: string[];
  ganda: string[];
  bukanBeban: string[];
  tidakBolehJurnal: string[];
}

/**
 * Setiap kategori operasional wajib terpetakan ke TEPAT SATU pos beban yang
 * boleh dijurnal (R3). Dipakai uji seed dan layar Daftar Pos.
 */
export function kelengkapanPeta(
  kategori: readonly string[],
  peta: readonly { kategori: string; kodePos: string }[],
  daftar: readonly Pos[],
  kodeLama: ReadonlyMap<string, string> = new Map(),
): KelengkapanPeta {
  const out: KelengkapanPeta = { tanpaPos: [], ganda: [], bukanBeban: [], tidakBolehJurnal: [] };
  for (const k of kategori) {
    const baris = peta.filter((r) => r.kategori === k);
    if (baris.length === 0) {
      out.tanpaPos.push(k);
      continue;
    }
    if (baris.length > 1) {
      out.ganda.push(k);
      continue;
    }
    const pos = posUntukKode(baris[0]!.kodePos, daftar, kodeLama);
    if (pos === null || pos.jenis !== "beban") out.bukanBeban.push(k);
    if (periksaPosJurnal(pos) !== null) out.tidakBolehJurnal.push(k);
  }
  return out;
}

export interface KelasPos {
  kelas: string;
  label: string;
  baris: { pos: Pos; anak: Pos[] }[];
}

/** Daftar pos tersusun per kelas, sub-pos di bawah induknya — untuk layar. */
export function susunDaftarPos(daftar: readonly Pos[]): KelasPos[] {
  const urut = [...daftar].sort((a, b) => a.kode.localeCompare(b.kode));
  const atas = urut.filter((p) => p.kodeInduk === null);
  return Object.keys(LABEL_KELAS).map((kelas) => ({
    kelas,
    label: LABEL_KELAS[kelas]!,
    baris: atas
      .filter((p) => p.kode.startsWith(kelas))
      .map((p) => ({ pos: p, anak: urut.filter((a) => a.kodeInduk === p.kode) })),
  }));
}
