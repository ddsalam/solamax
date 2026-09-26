/**
 * Pengaturan EDC — rekening pencairan tiap EDC, BERTANGGAL BERLAKU (§10.28).
 *
 * Murni (tanpa DB), supaya aturan "rekening mana yang berlaku pada tanggal X"
 * hidup di SATU tempat: layar Pengaturan EDC, saran rekening di formulir batch
 * settlement, dan pembanding di Pemantauan membaca fungsi yang sama —
 * `rekeningBerlaku`. Padanan SQL-nya (Pemantauan) memakai urutan yang sama:
 * `berlaku_sejak` terbesar ≤ tanggal, baris void diabaikan.
 */

/** Satu versi pengaturan (satu baris `app.edc_rekening_pencairan`). */
export interface VersiRekening {
  id: string;
  acquirer: string;
  toAccountId: string;
  namaAkun: string;
  /** `YYYY-MM-DD`. */
  berlakuSejak: string;
  catatan: string | null;
  oleh: string | null;
  /** WIB, `YYYY-MM-DD HH24:MI`. */
  dibuat: string;
  void: boolean;
}

/** Kode kartu EasyMax sebuah unit, dengan penjualannya di jendela layar. */
export interface KartuEdc {
  ckdkartu: string;
  namaKartu: string;
  /** `null` = belum dipetakan ke EDC mana pun. */
  acquirer: string | null;
  n: number;
  rp: number;
}

export interface BarisEdc {
  acquirer: string;
  kartu: KartuEdc[];
  /** Penjualan di jendela layar — penentu urutan: EDC terbesar di atas. */
  rp: number;
  n: number;
  /** Rekening yang berlaku HARI INI. */
  kini: VersiRekening | null;
  /** Pergantian yang sudah dijadwalkan (berlaku sesudah hari ini), terdekat dulu. */
  berikutnya: VersiRekening | null;
  /** Seluruh versi, termasuk yang dibatalkan — terbaru dulu. */
  riwayat: VersiRekening[];
}

/**
 * Ejaan tunggal nama EDC — sama dengan yang dipakai peta kode kartu
 * (`simpanPetaKartu`): huruf besar, spasi dirapikan. "bca " dan "BCA" adalah
 * EDC yang sama; tanpa ini, pengaturan dan batch settlement tak akan pernah
 * bertemu.
 */
export function normalisasiEdc(nama: string): string {
  return nama.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Rekening yang berlaku untuk `acquirer` pada `tanggal`: versi AKTIF dengan
 * `berlakuSejak` terbesar yang ≤ tanggal. `null` = belum pernah diatur (atau
 * baru berlaku sesudah tanggal itu).
 */
export function rekeningBerlaku(
  versi: readonly VersiRekening[],
  acquirer: string,
  tanggal: string,
): VersiRekening | null {
  const a = normalisasiEdc(acquirer);
  let hasil: VersiRekening | null = null;
  for (const v of versi) {
    if (v.void || normalisasiEdc(v.acquirer) !== a || v.berlakuSejak > tanggal) continue;
    if (hasil === null || v.berlakuSejak > hasil.berlakuSejak) hasil = v;
  }
  return hasil;
}

/** Pergantian terjadwal terdekat SESUDAH `tanggal` (aktif saja). */
function berikutnyaSesudah(
  versi: readonly VersiRekening[],
  acquirer: string,
  tanggal: string,
): VersiRekening | null {
  const a = normalisasiEdc(acquirer);
  let hasil: VersiRekening | null = null;
  for (const v of versi) {
    if (v.void || normalisasiEdc(v.acquirer) !== a || v.berlakuSejak <= tanggal) continue;
    if (hasil === null || v.berlakuSejak < hasil.berlakuSejak) hasil = v;
  }
  return hasil;
}

/**
 * Susun layar Pengaturan EDC. Daftar EDC = gabungan EDC dari peta kode kartu
 * DAN dari pengaturan yang pernah dibuat — EDC yang petanya dihapus tetapi
 * pernah punya rekening tetap terlihat, bukan hilang diam-diam.
 */
export function susunPengaturanEdc(
  kartu: readonly KartuEdc[],
  versi: readonly VersiRekening[],
  hariIni: string,
): { edc: BarisEdc[]; kartuTanpaPeta: KartuEdc[] } {
  const nama = new Set<string>();
  for (const k of kartu) if (k.acquirer !== null) nama.add(normalisasiEdc(k.acquirer));
  for (const v of versi) if (!v.void) nama.add(normalisasiEdc(v.acquirer));

  const edc: BarisEdc[] = [...nama].map((acquirer) => {
    const milik = kartu.filter((k) => k.acquirer !== null && normalisasiEdc(k.acquirer) === acquirer);
    return {
      acquirer,
      kartu: [...milik].sort((x, y) => y.rp - x.rp || x.ckdkartu.localeCompare(y.ckdkartu)),
      rp: milik.reduce((s, k) => s + k.rp, 0),
      n: milik.reduce((s, k) => s + k.n, 0),
      kini: rekeningBerlaku(versi, acquirer, hariIni),
      berikutnya: berikutnyaSesudah(versi, acquirer, hariIni),
      riwayat: versi
        .filter((v) => normalisasiEdc(v.acquirer) === acquirer)
        .sort((x, y) => y.berlakuSejak.localeCompare(x.berlakuSejak) || y.dibuat.localeCompare(x.dibuat)),
    };
  });
  edc.sort((x, y) => y.rp - x.rp || x.acquirer.localeCompare(y.acquirer));

  const kartuTanpaPeta = kartu
    .filter((k) => k.acquirer === null && k.n > 0)
    .sort((x, y) => y.rp - x.rp || x.ckdkartu.localeCompare(y.ckdkartu));
  return { edc, kartuTanpaPeta };
}

/**
 * Saran rekening untuk formulir batch settlement. Rekening yang berlaku pada
 * TANGGAL UANG MASUK (bukan hari penjualan): kesepakatan yang berganti hari ini
 * menentukan ke mana uang yang cair hari ini mendarat.
 */
export type SaranRekening =
  | { keadaan: "belum_diatur" }
  | { keadaan: "sesuai"; versi: VersiRekening }
  | { keadaan: "beda"; versi: VersiRekening };

export function saranRekening(
  versi: readonly VersiRekening[],
  acquirer: string,
  tanggalMasuk: string,
  dipilih: string,
): SaranRekening {
  if (acquirer.trim() === "") return { keadaan: "belum_diatur" };
  const v = rekeningBerlaku(versi, acquirer, tanggalMasuk);
  if (v === null) return { keadaan: "belum_diatur" };
  return v.toAccountId === dipilih ? { keadaan: "sesuai", versi: v } : { keadaan: "beda", versi: v };
}
