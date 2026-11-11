import { KATEGORI_PINDAH_BUKU, KATEGORI_SETORAN, KATEGORI_SETORAN_KE_BANK } from "./cocok-bank-model";
import type { AkunKas } from "./keuangan-kas-model";
import { rupiahKeSen } from "./pihak-lawan-model";
import { DATE_RE } from "./selection-keys";
import { UUID_RE } from "./validasi";

/**
 * TRANSFER KAS BESAR → BANK DUA KAKI (rencana 2026-11-11; R2–R7, R10–R11,
 * R13, R15; KTD2, KTD4, KTD6, KTD8). Modul MURNI — tanpa I/O, BUKAN
 * "use server"; dipakai aksi server, inti tulis, dan form.
 *
 * ⛔ DIAGNOSIS YANG MELAHIRKANNYA. "Setoran ke Bank" hanya ada di sisi KREDIT
 * (0029 menanam kategori per sisi, bukan per jenis rekening), jadi kaki bank
 * sebuah setoran dari Kas Besar TIDAK PERNAH bisa berlabel itu. Kaki bank yang
 * benar adalah debet "Pindah Buku" — P6 seperti kaki Kas Besarnya: keduanya
 * lewat 1190 dan saling menolkan di hari yang sama, 1103 tak tersentuh. Finance
 * memilih "Setoran Hasil Penjualan" (P2), yang mengkredit 1103 KEDUA kalinya —
 * setoran pengawas sudah mengkreditnya saat masuk Kas Besar. Kategori kedua
 * kaki karena itu DITETAPKAN di sini, tak pernah dari klien (R4) — persis
 * pasangan otomatis jemputan `tulisPasanganJemputan`.
 */

/** Kaki Kas Besar: kredit. */
export const KATEGORI_KAKI_KAS = KATEGORI_SETORAN_KE_BANK;
/** Kaki bank: debet. */
export const KATEGORI_KAKI_BANK = KATEGORI_PINDAH_BUKU;
/** Kategori kaki Kas Besar yang sah sebagai pasangan transfer (P6) — termasuk "Pindah Buku" lama. */
export const KATEGORI_KELUAR_KAS_BESAR: readonly string[] = [KATEGORI_SETORAN_KE_BANK, KATEGORI_PINDAH_BUKU];

/** Hari buku satu kaki — bentuk `hariBukuTerkunci`, disempitkan untuk model. */
export type HariKaki =
  | { status: "pra-cut-over"; cutOver: string }
  | { status: "dibukukan"; hariBuku: string; perluKodeAlasan: boolean };

export interface KakiTransfer {
  accountId: string;
  jenis: "debet" | "kredit";
  kategori: string;
  /** Sen BERTANDA: kredit < 0, debet > 0. */
  amountSen: number;
}

export interface RencanaTransfer {
  hariBuku: string;
  /** Terdorong maju ⇒ kedua kaki membawa `tanggal_asal` + `ADJ-FWD-TRANSFER`. */
  maju: boolean;
  kas: KakiTransfer;
  bank: KakiTransfer;
}

export type Hasil<T> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Pemeriksaan masukan SEBELUM koneksi: nominal rupiah positif (≤ 2 desimal),
 * keterangan, tanggal, dan kunci idempotensi berbentuk UUID (KTD5).
 */
export function periksaMasukanTransfer(m: {
  amount: number;
  keterangan: string;
  tanggal: string;
  kunci: string;
}): Hasil<{ sen: number; keterangan: string }> {
  if (!DATE_RE.test(m.tanggal)) return { ok: false, error: "Tanggal tak valid." };
  if (!UUID_RE.test(m.kunci)) return { ok: false, error: "Kunci transfer tak valid — muat ulang halaman." };
  const sen = rupiahKeSen(m.amount);
  if (sen === null || sen <= 0) {
    return { ok: false, error: "Nominal transfer harus angka rupiah positif, paling banyak dua desimal." };
  }
  const keterangan = m.keterangan.trim();
  if (keterangan === "") return { ok: false, error: "Keterangan wajib diisi." };
  return { ok: true, sen, keterangan };
}

/** Sumber = Kas Besar aktif; tujuan = rekening `bank` aktif. `null` = sah. */
export function periksaRekeningTransfer(akunKas: AkunKas | null, akunBank: AkunKas | null): string | null {
  if (akunKas === null || akunKas.kind !== "kas" || !akunKas.active) {
    return "Kas Besar unit ini tak ditemukan atau tidak aktif — transfer tidak dicatat.";
  }
  if (akunBank === null || akunBank.kind !== "bank") {
    return "Rekening tujuan harus rekening bank unit ini (bukan Kas Besar atau EDC Penampungan).";
  }
  if (!akunBank.active) return "Rekening tujuan sudah nonaktif — pilih rekening bank yang aktif.";
  return null;
}

/**
 * Dua kaki satu transfer, atau penolakan. Rekening dibaca di server (unit
 * sama sudah dijamin RLS + `unit_id`); di sini yang diputus adalah JENISnya:
 * sumber = satu-satunya rekening `kas` (Kas Besar), tujuan = rekening `bank`
 * aktif. Hari buku kedua kaki dari `hariBukuTerkunci` per rekening (KTD4):
 * pra-cut-over ⇒ ditolak; hari buku berbeda ⇒ ditolak (kalau tidak, 1190
 * tertinggal di antara dua hari — pola `tulisPasanganJemputan`).
 */
export function rencanaTransfer(m: {
  amount: number;
  keterangan: string;
  tanggal: string;
  kunci: string;
  akunKas: AkunKas | null;
  akunBank: AkunKas | null;
  hariKas: HariKaki;
  hariBank: HariKaki;
}): Hasil<{ rencana: RencanaTransfer; keterangan: string }> {
  const masuk = periksaMasukanTransfer(m);
  if (!masuk.ok) return masuk;
  const salahAkun = periksaRekeningTransfer(m.akunKas, m.akunBank);
  if (salahAkun !== null || m.akunKas === null || m.akunBank === null) return { ok: false, error: salahAkun ?? "Rekening tak valid." };
  for (const h of [m.hariKas, m.hariBank]) {
    if (h.status === "pra-cut-over") {
      return {
        ok: false,
        error: `Tanggal ${m.tanggal} mendahului saldo pembuka (${h.cutOver}) — sudah termuat di saldo pembuka, jadi tidak dibukukan.`,
      };
    }
  }
  const hk = m.hariKas as Extract<HariKaki, { status: "dibukukan" }>;
  const hb = m.hariBank as Extract<HariKaki, { status: "dibukukan" }>;
  if (hk.hariBuku !== hb.hariBuku) {
    return {
      ok: false,
      error:
        `Hari buku Kas Besar (${hk.hariBuku}) dan rekening bank (${hb.hariBuku}) berbeda — ` +
        "kedua kaki harus satu hari supaya Dana dalam Perjalanan (1190) kembali nol. Minta Head of Finance memeriksa tutup harinya.",
    };
  }
  const maju = hk.perluKodeAlasan || hb.perluKodeAlasan;
  return {
    ok: true,
    keterangan: masuk.keterangan,
    rencana: {
      hariBuku: hk.hariBuku,
      maju,
      kas: { accountId: m.akunKas.id, jenis: "kredit", kategori: KATEGORI_KAKI_KAS, amountSen: -masuk.sen },
      bank: { accountId: m.akunBank.id, jenis: "debet", kategori: KATEGORI_KAKI_BANK, amountSen: masuk.sen },
    },
  };
}

// ---------------------------------------------------------------------------
// Penjaga tab bank (R13, KTD8)
// ---------------------------------------------------------------------------

/** Kaki Kas Besar yang dipertimbangkan detektor & daftar koreksi. */
export interface BarisKasBesar {
  id: string;
  tanggal: string;
  kategori: string | null;
  /** Sen BERTANDA. */
  amountSen: number;
  transferUuid: string | null;
  void: boolean;
}

/** Kaki keluar Kas Besar yang belum bertaut: kredit P6, belum void, tanpa transfer_uuid. */
const kakiKeluarBebas = (k: BarisKasBesar): boolean =>
  !k.void && k.transferUuid === null && k.amountSen < 0 && k.kategori !== null && KATEGORI_KELUAR_KAS_BESAR.includes(k.kategori);

/**
 * Apakah baris bank yang AKAN disimpan ini tampaknya kaki bank sebuah transfer
 * dari Kas Besar yang salah kategori? Bank + debet + "Setoran Hasil Penjualan",
 * dan di Kas Besar pada tanggal yang sama ada kaki keluar P6 bebas bernominal
 * SAMA PERSIS (sen). Bukan larangan — "Setoran Hasil Penjualan" di bank sah
 * untuk setoran langsung (aturan cocok 3); konfirmasi eksplisit melewatinya.
 */
export function kakiTransferTerlewat(
  row: { accountKind: string | null | undefined; jenis: string; kategori: string | null; amountSen: number; tanggal: string },
  kasRows: readonly BarisKasBesar[],
): boolean {
  if (row.accountKind !== "bank" || row.jenis !== "debet" || row.kategori !== KATEGORI_SETORAN || row.amountSen <= 0) return false;
  return kasRows.some((k) => kakiKeluarBebas(k) && k.tanggal === row.tanggal && k.amountSen === -row.amountSen);
}

export const PESAN_KAKI_TRANSFER_TERLEWAT = (rupiah: string): string =>
  `Di Kas Besar tanggal ini ada 'Setoran ke Bank' sebesar Rp ${rupiah}. Bila uang ini pindahan dari Kas Besar, ` +
  "kategorinya 'Pindah Buku' — 'Setoran Hasil Penjualan' akan mengkredit 1103 dua kali.";

export const PESAN_TOLAK_TANPA_KONFIRMASI = (rupiah: string): string =>
  `${PESAN_KAKI_TRANSFER_TERLEWAT(rupiah)} Pakai kategori Pindah Buku, atau centang 'setoran langsung' bila memang bukan dari Kas Besar.`;

// ---------------------------------------------------------------------------
// Daftar koreksi (R15)
// ---------------------------------------------------------------------------

export interface BarisBankKoreksi {
  id: string;
  accountId: string;
  tanggal: string;
  kategori: string | null;
  amountSen: number;
  transferUuid: string | null;
  void: boolean;
  /** Untuk urutan stabil "terlama dulu". */
  dibuat: string;
  /**
   * Lahir dari setoran pengawas yang disetujui (`source_manual_entry_id`). Bukan
   * kaki transfer: menyisip ulangnya memutus tautan setoran, dan setoran itu
   * akan DITAWARKAN lagi — dua kali dibukukan.
   */
  dariSetoranPengawas?: boolean;
}

export interface KandidatSiap {
  bank: BarisBankKoreksi;
  kas: BarisKasBesar;
  /** Kaki Kas Besar "Pindah Buku" lama: sah P6, tetapi pencocok bank memakai aturan 6, bukan 3. */
  catatan: string | null;
}

export interface KandidatManual {
  bank: BarisBankKoreksi;
  alasan: string;
}

export const CATATAN_KAKI_PINDAH_BUKU =
  "Kaki Kas Besar berlabel Pindah Buku (bukan Setoran ke Bank): tetap P6 dan sah. Di Impor rekening koran " +
  "baris ini cocok lewat aturan 6 (ketikan), bukan aturan 3 (setoran jemputan).";

/**
 * Baris bank "Setoran Hasil Penjualan" (debet, non-void, belum bertaut) yang
 * pada tanggal yang sama punya TEPAT SATU kaki keluar P6 bebas Kas Besar
 * bernominal sama ⇒ `siap`. Nol atau lebih dari satu calon — atau satu calon
 * yang diperebutkan lebih dari satu baris bank — ⇒ `periksaManual` tanpa
 * tombol: sistem tak menebak pasangan. Urut terlama dulu.
 */
export function kandidatJadikanTransfer(
  bankRows: readonly BarisBankKoreksi[],
  kasRows: readonly BarisKasBesar[],
): { siap: KandidatSiap[]; periksaManual: KandidatManual[] } {
  const calonBank = bankRows
    .filter((b) => !b.void && b.transferUuid === null && b.kategori === KATEGORI_SETORAN && b.amountSen > 0)
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.dibuat.localeCompare(b.dibuat) || a.id.localeCompare(b.id));
  const kasBebas = kasRows.filter(kakiKeluarBebas);
  const calonPer = new Map<string, BarisKasBesar[]>();
  const diperebutkan = new Map<string, number>();
  for (const b of calonBank) {
    const c = kasBebas.filter((k) => k.tanggal === b.tanggal && k.amountSen === -b.amountSen);
    calonPer.set(b.id, c);
    if (c.length === 1 && !b.dariSetoranPengawas) diperebutkan.set(c[0]!.id, (diperebutkan.get(c[0]!.id) ?? 0) + 1);
  }
  const siap: KandidatSiap[] = [];
  const periksaManual: KandidatManual[] = [];
  for (const b of calonBank) {
    const c = calonPer.get(b.id) ?? [];
    if (b.dariSetoranPengawas) {
      periksaManual.push({
        bank: b,
        alasan: "Lahir dari setoran pengawas yang disetujui langsung ke rekening ini — setoran langsung, bukan kaki transfer.",
      });
    } else if (c.length === 0) {
      periksaManual.push({
        bank: b,
        alasan: "Tak ada kaki keluar Kas Besar bernominal sama di tanggal ini — mungkin setoran langsung ke bank. Periksa slip & rekening koran.",
      });
    } else if (c.length > 1) {
      periksaManual.push({ bank: b, alasan: `${c.length} kaki keluar Kas Besar bernominal sama di tanggal ini — pasangannya tak bisa dipilih otomatis.` });
    } else if ((diperebutkan.get(c[0]!.id) ?? 0) > 1) {
      periksaManual.push({ bank: b, alasan: "Satu kaki Kas Besar cocok dengan lebih dari satu baris bank di tanggal ini — periksa manual." });
    } else {
      const kas = c[0]!;
      siap.push({ bank: b, kas, catatan: kas.kategori === KATEGORI_PINDAH_BUKU ? CATATAN_KAKI_PINDAH_BUKU : null });
    }
  }
  return { siap, periksaManual };
}

// ---------------------------------------------------------------------------
// Vonis pembatalan & koreksi (R11, R17; KTD6, KTD7)
// ---------------------------------------------------------------------------

export const PESAN_TRANSFER_DICOCOKKAN =
  "Salah satu kaki transfer sudah dicocokkan dengan rekening koran — minta Head of Finance membatalkan cocoknya dulu " +
  "(Impor rekening koran), baru transfer bisa dibatalkan.";
export const PESAN_BULAN_TUTUP = "Bulan ini sudah ditutup — koreksinya lewat jurnal memorial Head of Finance.";

/** `null` = boleh dibatalkan. Dua kaki, keduanya hidup; tak dicocokkan; hari & bulan terbuka. */
export function vonisBatalTransfer(m: {
  legs: readonly { void: boolean }[];
  dicocokkan: boolean;
  hariTutup: boolean;
  bulanTutup: boolean;
}): string | null {
  if (m.legs.length !== 2 || m.legs.some((l) => l.void)) return "Transfer tak ditemukan atau sudah dibatalkan — muat ulang halaman.";
  if (m.bulanTutup) return PESAN_BULAN_TUTUP;
  if (m.hariTutup) {
    return "Hari buku transfer ini sudah ditutup — membatalkannya mengubah kas hari tertutup. Koreksinya lewat Head of Finance (§10.48).";
  }
  if (m.dicocokkan) return PESAN_TRANSFER_DICOCOKKAN;
  return null;
}

/**
 * "Jadikan transfer" boleh? `null` = boleh. Hari tertutup (bulan terbuka) ⇒
 * hanya HoF/super admin, dengan alasan tertulis (KTD7). Bulan tertutup atau
 * baris di kelompok cocok aktif ⇒ ditolak.
 */
export function vonisJadikanTransfer(m: {
  bulanTutup: boolean;
  hariTutup: boolean;
  dicocokkan: boolean;
  bolehHariTutup: boolean;
  alasan: string;
}): string | null {
  if (m.bulanTutup) return PESAN_BULAN_TUTUP;
  if (m.dicocokkan) {
    return "Baris bank atau kaki Kas Besarnya sudah dicocokkan dengan rekening koran — minta Head of Finance membatalkan cocoknya dulu.";
  }
  if (m.hariTutup) {
    if (!m.bolehHariTutup) return "Hari ini sudah ditutup — koreksi kategorinya hanya oleh Head of Finance (dengan alasan tertulis).";
    if (m.alasan.trim() === "") return "Hari ini sudah ditutup — alasan koreksi wajib diisi.";
  }
  return null;
}
