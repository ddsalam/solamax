/**
 * Kelola Akun Kas — aturan MURNI (tanpa I/O). Rujukan: §10.18.
 *
 * Daftar rekening berhenti hidup di migrasi. Tujuh SPBU × 5–7 rekening, plus
 * yang dibuka dan ditutup sepanjang tahun — seed migrasi menjadikan setiap
 * perubahan rekening bank sebagai rilis kode.
 *
 * ⛔ **`active` dan `closed_at` DILAS** oleh CHECK 0029:72
 * (`active = (closed_at IS NULL)`). Tak ada keadaan "nonaktif tetapi belum
 * ditutup"; menonaktifkan MEWAJIBKAN tanggal. Berkas ini tak pernah
 * memperlakukan keduanya sebagai dua fakta terpisah.
 */

export type KindAkun = "kas" | "bank" | "edc_penampungan";

/** Nama yang WAJIB persis sama di setiap unit — papan grup membandingkan by nama. */
export const NAMA_BAKU: Readonly<Record<Exclude<KindAkun, "bank">, string>> = {
  kas: "Kas Besar",
  edc_penampungan: "EDC Penampungan",
};

export interface AkunKasRow {
  id: string;
  nama: string;
  kind: KindAkun;
  active: boolean;
  closedAt: string | null;
  /** Jumlah mutasi non-void yang menggantung pada akun ini. */
  nMutasi: number;
  /** `YYYY-MM-DD` mutasi terakhir; `null` = belum pernah dipakai. */
  mutasiTerakhir: string | null;
}

// ---------------------------------------------------------------------------
// Penanda DORMAN — turunan, bukan keadaan (§10.18)
// ---------------------------------------------------------------------------

/**
 * Ambang dorman dalam hari. Bukan angka gaya: rekening kas yang hidup dipakai
 * tiap minggu, jadi 90 hari cukup jauh untuk tidak menuduh rekening yang
 * sekadar sepi, dan cukup dekat untuk menandai empat rekening Bakau yang sudah
 * diam 2–5 tahun.
 */
export const AMBANG_DORMAN_HARI = 90;

/**
 * Rekening ini dorman pada `asOf`?
 *
 * ⛔ **TURUNAN, bukan keadaan yang disimpan.** Begitu rekeningnya dipakai lagi,
 * tandanya hilang sendiri — tak ada yang perlu mengingat untuk mencabutnya.
 * Keadaan yang disimpan butuh seseorang mengubahnya; turunan tidak.
 *
 * Akun tidak-aktif TIDAK dihitung dorman: ia sudah punya penandanya sendiri,
 * dan dua penanda untuk satu keadaan membuat pembacanya menebak mana yang
 * berlaku.
 */
export function dorman(a: Pick<AkunKasRow, "active" | "mutasiTerakhir">, asOf: string): boolean {
  if (!a.active) return false;
  if (a.mutasiTerakhir === null) return true;
  return selisihHari(a.mutasiTerakhir, asOf) >= AMBANG_DORMAN_HARI;
}

function selisihHari(dari: string, ke: string): number {
  return Math.round((Date.parse(`${ke}T00:00:00Z`) - Date.parse(`${dari}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Penamaan — ditegakkan di FORM, sebab `nama` adalah IDENTITAS
// ---------------------------------------------------------------------------

export type SalahNama =
  | "kosong"
  | "bank_tanpa_nomor"
  | "memuat_nama_spbu"
  | "baku_harus_persis"
  | "sudah_ada_aktif";

export const PESAN_SALAH_NAMA: Record<SalahNama, string> = {
  kosong: "Nama rekening wajib diisi.",
  bank_tanpa_nomor:
    "Rekening bank harus menyebut nomor rekening penuh — format “Bank BCA - 5125036811”. " +
    "Bakau punya DUA rekening BCA; tanpa nomornya keduanya tak terbedakan.",
  memuat_nama_spbu:
    "Nama rekening tidak memuat nama SPBU — akun sudah terikat unitnya. " +
    "“Kas Besar Bakau” merusak perbandingan lintas unit di papan grup.",
  baku_harus_persis:
    "Kas Besar dan EDC Penampungan harus dinamai persis sama di setiap unit — " +
    "papan grup membandingkan berdasarkan nama.",
  sudah_ada_aktif: "Sudah ada rekening aktif dengan nama itu di unit ini.",
};

export interface KonteksNama {
  kind: KindAkun;
  /** Nama unit, untuk menolak "Kas Besar Bakau". */
  namaUnit: string;
  /** Seluruh akun unit ini — aktif maupun tidak. */
  akun: readonly Pick<AkunKasRow, "id" | "nama" | "active">[];
  /** Diisi saat MENGUBAH nama: id yang sedang disunting, dikecualikan dari bentrok. */
  kecualiId?: string;
}

/**
 * Periksa nama. Mengembalikan daftar pelanggaran — kosong berarti sah.
 *
 * Bank wajib bernomor: pola `Bank <sesuatu> - <angka>`. Angkanya tidak
 * divalidasi panjangnya; nomor rekening bank Indonesia beragam, dan menolak
 * yang sah lebih mahal daripada menerima yang aneh.
 */
export function periksaNama(nama: string, ctx: KonteksNama): SalahNama[] {
  const n = nama.trim();
  const out: SalahNama[] = [];
  if (n === "") return ["kosong"];

  if (ctx.kind === "bank") {
    if (!/^Bank\s+.+\s-\s*\d+$/.test(n)) out.push("bank_tanpa_nomor");
  } else {
    if (n !== NAMA_BAKU[ctx.kind]) out.push("baku_harus_persis");
  }

  const unit = ctx.namaUnit.trim();
  if (unit !== "" && n.toLowerCase().includes(unit.toLowerCase())) out.push("memuat_nama_spbu");

  const bentrok = ctx.akun.find(
    (a) => a.id !== ctx.kecualiId && a.active && a.nama.toLowerCase() === n.toLowerCase(),
  );
  if (bentrok) out.push("sudah_ada_aktif");

  return out;
}

// ---------------------------------------------------------------------------
// Jebakan reaktivasi (§10.18 butir 3)
// ---------------------------------------------------------------------------

/**
 * Ada baris TIDAK-AKTIF bernama sama? Kalau ya, "Tambah" akan ditolak kunci
 * unik `cash_account_nama_uq` — yang **bukan indeks parsial**, jadi ia mencakup
 * baris tidak-aktif juga — dan galatnya terbaca seperti bug.
 *
 * Form memakai ini untuk menawarkan **mengaktifkan kembali** alih-alih membuat
 * baru. Mengaktifkan berarti mengosongkan `closed_at`, sebab CHECK-nya mengelas
 * keduanya.
 */
export function kandidatAktifkanKembali(
  nama: string,
  akun: readonly Pick<AkunKasRow, "id" | "nama" | "active">[],
): { id: string; nama: string } | null {
  const n = nama.trim().toLowerCase();
  const m = akun.find((a) => !a.active && a.nama.toLowerCase() === n);
  return m ? { id: m.id, nama: m.nama } : null;
}

/** Boleh dinonaktifkan? Mutasi yang menggantung harus terlihat lebih dulu. */
export interface HasilNonaktif {
  boleh: boolean;
  nMutasi: number;
  /** Peringatan yang HARUS dibaca sebelum menonaktifkan; bukan penghalang. */
  peringatan: string | null;
}

export function periksaNonaktif(a: Pick<AkunKasRow, "active" | "nMutasi">): HasilNonaktif {
  if (!a.active) return { boleh: false, nMutasi: a.nMutasi, peringatan: "Akun ini sudah tidak aktif." };
  return {
    boleh: true,
    nMutasi: a.nMutasi,
    peringatan:
      a.nMutasi > 0
        ? `${a.nMutasi} mutasi menggantung pada akun ini. Mutasinya tetap ada dan tetap ` +
          `dihitung — yang berhenti hanyalah akun ini ditawarkan saat menginput.`
        : null,
  };
}
