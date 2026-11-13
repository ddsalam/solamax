import { addDays, isValidIsoDate } from "./periods";

/**
 * Model murni tagihan pelanggan: jatuh tempo → status bayar → status jatuh
 * tempo → penanda. Tanpa I/O dan tanpa jam: "hari ini" selalu diserahkan
 * pemanggil sebagai tanggal bisnis WIB ("YYYY-MM-DD"). Status tidak pernah
 * disimpan — ia bergantung pada hari ini dan pada termin yang bisa diubah.
 */

export const TAGIHAN_PAGE_SIZE = 50;

/**
 * Batas kewajaran jatuh tempo EasyMax, dalam hari sesudah tanggal faktur.
 * Sementara; satu-satunya tempat angka ini hidup.
 */
export const BATAS_JATUH_TEMPO_EASYMAX_HARI = 365;

/** Flag status EasyMax yang berarti "lunas". Nilai lain = belum lunas. */
export const STATUS_EASYMAX_LUNAS = 1;

export const TAGIHAN_FILTERS = ["perlu_tindakan", "lewat_jatuh_tempo", "sebagian", "lebih_bayar", "lunas"] as const;
export const TAGIHAN_FILTER_DEFAULT = "perlu_tindakan" satisfies (typeof TAGIHAN_FILTERS)[number];

export type TagihanFilter = (typeof TAGIHAN_FILTERS)[number];

export function isTagihanFilter(value: unknown): value is TagihanFilter {
  return typeof value === "string" && TAGIHAN_FILTERS.some((candidate) => candidate === value);
}

/** Nilai tak dikenal jatuh ke bawaan, sama seperti filter saldo. */
export function normalizeTagihanFilter(value: string | null | undefined): TagihanFilter {
  return isTagihanFilter(value) ? value : TAGIHAN_FILTER_DEFAULT;
}

/** Satu faktur dari cermin EasyMax, apa adanya. */
export interface TagihanFaktur {
  /** Kunci faktur EasyMax (nomor faktur). */
  kode: string;
  customerCode: string;
  /** Tanggal faktur, "YYYY-MM-DD" WIB. */
  tanggalFaktur: string;
  /** Jatuh tempo mentah dari EasyMax; tanggal nol sudah menjadi `null` saat ingest. */
  jatuhTempoEasymax: string | null;
  /** Nilai faktur dalam rupiah (kolom sumber bertitik-mengambang). */
  nilai: number;
  /** Flag status EasyMax; hanya pembanding, tidak pernah menentukan status. */
  statusEasymax: number | null;
  /** Kolom sisa tagihan EasyMax; hanya pembanding. */
  sisaEasymax: number | null;
  batal: boolean;
}

export interface TagihanPembayaran {
  jumlah: number;
  batal: boolean;
}

/** Termin pembayaran SolaMax dalam hari; `null` = belum diatur. Nol hari sah. */
export interface TagihanTermin {
  terminPelanggan: number | null;
  terminUnit: number | null;
}

export type SumberJatuhTempo = "easymax" | "termin_pelanggan" | "termin_unit" | "belum_diatur";

export interface JatuhTempoTagihan {
  /** `null` hanya ketika sumbernya `belum_diatur`. */
  jatuhTempo: string | null;
  sumber: SumberJatuhTempo;
  /** Termin yang dipakai, dalam hari; `null` bila sumbernya EasyMax atau belum diatur. */
  terminHari: number | null;
  /** Jatuh tempo EasyMax terisi tetapi tak wajar: sebelum tanggal faktur atau melewati batas. */
  jtEasymaxTakWajar: boolean;
}

export type StatusBayarTagihan = "belum_dibayar" | "sebagian" | "lunas" | "lebih_bayar";
export type StatusJatuhTempoTagihan = "belum_jatuh_tempo" | "lewat_jatuh_tempo" | "termin_belum_diatur";

export interface TagihanStatus extends JatuhTempoTagihan {
  /** Nilai faktur, rupiah bulat. */
  nilai: number;
  /** Jumlah pembayaran yang tidak batal, rupiah bulat. */
  dibayar: number;
  /** `nilai − dibayar`, rupiah bulat. Negatif = lebih bayar. */
  sisa: number;
  statusBayar: StatusBayarTagihan;
  /** `null` untuk lunas dan lebih bayar: tidak ada sisa yang bisa jatuh tempo. */
  statusJatuhTempo: StatusJatuhTempoTagihan | null;
  /** Hari lewat jatuh tempo; 0 bila tidak lewat. */
  hariLewat: number;
  /** Hari menuju jatuh tempo (0 = hari ini); `null` bila lewat, tanpa termin, atau tanpa sisa. */
  hariMenujuJatuhTempo: number | null;
  /** Status bayar hitungan tidak cocok dengan flag status EasyMax. */
  bedaStatus: boolean;
  /** Sisa hitungan tidak cocok dengan kolom sisa EasyMax. */
  bedaSisa: boolean;
}

/** Faktur beserta status turunannya — satu baris daftar. */
export interface TagihanRow {
  faktur: TagihanFaktur;
  status: TagihanStatus;
}

/** Selisih hari kalender `to − from`; aritmetika UTC agar batas bulan/tahun tidak bergeser. */
function selisihHari(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Kolom sumber bertitik-mengambang; semua perbandingan dilakukan dalam rupiah bulat. */
function rupiahBulat(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

function terminSah(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Jatuh tempo satu faktur (KTD5).
 *
 * Jatuh tempo EasyMax sah hanya bila 1..BATAS hari sesudah tanggal faktur.
 * Kosong atau sama dengan tanggal faktur = tidak diisi, tanpa penanda.
 * Sebelum tanggal faktur atau melewati batas = penanda `jt_easymax_tak_wajar`
 * dan tidak pernah dipakai. Sesudah itu termin pelanggan menang atas termin
 * unit; termin 0 hari sah (jatuh tempo pada tanggal faktur).
 */
export function resolveJatuhTempo(
  faktur: Pick<TagihanFaktur, "tanggalFaktur" | "jatuhTempoEasymax">,
  termin: TagihanTermin,
): JatuhTempoTagihan {
  let jtEasymaxTakWajar = false;
  if (isValidIsoDate(faktur.jatuhTempoEasymax ?? undefined)) {
    const jarak = selisihHari(faktur.tanggalFaktur, faktur.jatuhTempoEasymax!);
    if (jarak >= 1 && jarak <= BATAS_JATUH_TEMPO_EASYMAX_HARI) {
      return { jatuhTempo: faktur.jatuhTempoEasymax, sumber: "easymax", terminHari: null, jtEasymaxTakWajar: false };
    }
    jtEasymaxTakWajar = jarak !== 0;
  }
  if (terminSah(termin.terminPelanggan)) {
    return { jatuhTempo: addDays(faktur.tanggalFaktur, termin.terminPelanggan), sumber: "termin_pelanggan",
      terminHari: termin.terminPelanggan, jtEasymaxTakWajar };
  }
  if (terminSah(termin.terminUnit)) {
    return { jatuhTempo: addDays(faktur.tanggalFaktur, termin.terminUnit), sumber: "termin_unit",
      terminHari: termin.terminUnit, jtEasymaxTakWajar };
  }
  return { jatuhTempo: null, sumber: "belum_diatur", terminHari: null, jtEasymaxTakWajar };
}

/**
 * Status lengkap satu faktur. Faktur batal tidak punya status (`null`);
 * pembayaran batal tidak pernah dihitung. Status bayar dihitung dari
 * pembayaran, bukan dari flag EasyMax — flag itu hanya pembanding.
 * Tanpa ambang lebih bayar (KTD10): kelebihan berapa pun = lebih bayar.
 */
export function deriveTagihanStatus(
  faktur: TagihanFaktur,
  pembayaran: readonly TagihanPembayaran[],
  termin: TagihanTermin,
  hariIni: string,
): TagihanStatus | null {
  if (faktur.batal) return null;

  const nilai = rupiahBulat(faktur.nilai);
  const dibayar = rupiahBulat(pembayaran.reduce((total, bayar) => bayar.batal ? total : total + bayar.jumlah, 0));
  const sisa = nilai - dibayar;
  const statusBayar: StatusBayarTagihan = dibayar > nilai ? "lebih_bayar"
    : dibayar === nilai ? "lunas"
    : dibayar > 0 ? "sebagian" : "belum_dibayar";

  const jatuhTempo = resolveJatuhTempo(faktur, termin);
  let statusJatuhTempo: StatusJatuhTempoTagihan | null = null;
  let hariLewat = 0;
  let hariMenujuJatuhTempo: number | null = null;
  if (statusBayar === "belum_dibayar" || statusBayar === "sebagian") {
    if (jatuhTempo.jatuhTempo === null) {
      statusJatuhTempo = "termin_belum_diatur";
    } else {
      // Hari ini sama dengan jatuh tempo belum lewat.
      const lewat = selisihHari(jatuhTempo.jatuhTempo, hariIni);
      if (lewat > 0) {
        statusJatuhTempo = "lewat_jatuh_tempo";
        hariLewat = lewat;
      } else {
        statusJatuhTempo = "belum_jatuh_tempo";
        hariMenujuJatuhTempo = lewat === 0 ? 0 : -lewat;
      }
    }
  }

  // Flag EasyMax hanya mengenal lunas / belum; lebih bayar dengan flag lunas bukan selisih.
  const terbayarPenuh = statusBayar === "lunas" || statusBayar === "lebih_bayar";
  const bedaStatus = faktur.statusEasymax !== null
    && terbayarPenuh !== (faktur.statusEasymax === STATUS_EASYMAX_LUNAS);
  const bedaSisa = faktur.sisaEasymax !== null && rupiahBulat(faktur.sisaEasymax) !== sisa;

  return { ...jatuhTempo, nilai, dibayar, sisa, statusBayar, statusJatuhTempo, hariLewat, hariMenujuJatuhTempo, bedaStatus, bedaSisa };
}

/** Keanggotaan satu filter. `perlu_tindakan` = semua yang tidak persis lunas, termasuk lebih bayar. */
export function matchesTagihanFilter(status: TagihanStatus, filter: TagihanFilter): boolean {
  switch (filter) {
    case "perlu_tindakan": return status.statusBayar !== "lunas";
    case "lewat_jatuh_tempo": return status.statusJatuhTempo === "lewat_jatuh_tempo";
    case "sebagian": return status.statusBayar === "sebagian";
    case "lebih_bayar": return status.statusBayar === "lebih_bayar";
    case "lunas": return status.statusBayar === "lunas";
  }
}

/** Urutan bawaan: hari lewat menurun, jatuh tempo menaik (tanpa tanggal di akhir), lalu kode faktur. */
export function compareTagihanRows(left: TagihanRow, right: TagihanRow): number {
  const lewat = right.status.hariLewat - left.status.hariLewat;
  if (lewat !== 0) return lewat;
  const a = left.status.jatuhTempo;
  const b = right.status.jatuhTempo;
  if (a !== b) {
    if (a === null) return 1;
    if (b === null) return -1;
    return a < b ? -1 : 1;
  }
  return left.faktur.kode < right.faktur.kode ? -1 : left.faktur.kode > right.faktur.kode ? 1 : 0;
}

export interface TagihanPage<Row> {
  rows: Row[];
  page: number;
  totalPages: number;
  resultCount: number;
  pageSize: number;
}

/** Baris sudah disaring dan diurutkan; halaman di luar rentang dijepit, sama seperti layar saldo. */
export function paginateTagihan<Row>(rows: readonly Row[], page: string | number | null | undefined): TagihanPage<Row> {
  const totalPages = Math.max(1, Math.ceil(rows.length / TAGIHAN_PAGE_SIZE));
  const parsed = typeof page === "number"
    ? (Number.isInteger(page) ? page : 1)
    : typeof page === "string" && /^\d+$/.test(page.trim())
      ? Number(page.trim())
      : 1;
  const current = Math.min(Math.max(parsed, 1), totalPages);
  const start = (current - 1) * TAGIHAN_PAGE_SIZE;
  return { rows: rows.slice(start, start + TAGIHAN_PAGE_SIZE), page: current, totalPages,
    resultCount: rows.length, pageSize: TAGIHAN_PAGE_SIZE };
}

export interface TagihanRingkasanSel {
  /** Banyaknya faktur. */
  jumlah: number;
  /** Total sisa, rupiah bulat. */
  sisa: number;
}

/** Ubin ringkasan dari status jatuh tempo. "Belum ditagihkan" dihitung di tempat lain. */
export interface TagihanRingkasan {
  lewatJatuhTempo: TagihanRingkasanSel;
  belumJatuhTempo: TagihanRingkasanSel;
  terminBelumDiatur: TagihanRingkasanSel;
}

/** Lunas dan lebih bayar tidak masuk ubin mana pun: tidak ada sisa yang ditagih. */
export function summarizeTagihan(statuses: readonly TagihanStatus[]): TagihanRingkasan {
  const ringkasan: TagihanRingkasan = {
    lewatJatuhTempo: { jumlah: 0, sisa: 0 },
    belumJatuhTempo: { jumlah: 0, sisa: 0 },
    terminBelumDiatur: { jumlah: 0, sisa: 0 },
  };
  for (const status of statuses) {
    const sel = status.statusJatuhTempo === "lewat_jatuh_tempo" ? ringkasan.lewatJatuhTempo
      : status.statusJatuhTempo === "belum_jatuh_tempo" ? ringkasan.belumJatuhTempo
      : status.statusJatuhTempo === "termin_belum_diatur" ? ringkasan.terminBelumDiatur : null;
    if (!sel) continue;
    sel.jumlah += 1;
    sel.sisa += status.sisa;
  }
  return ringkasan;
}

/** Pil status bayar. Belum dibayar tidak punya pil — pil jatuh temponya yang berbicara. */
export function tagihanStatusBayarLabel(statusBayar: StatusBayarTagihan): string | null {
  return statusBayar === "sebagian" ? "Sebagian"
    : statusBayar === "lunas" ? "Lunas"
    : statusBayar === "lebih_bayar" ? "Lebih bayar" : null;
}

/** Pil jatuh tempo; `null` untuk lunas dan lebih bayar. */
export function tagihanJatuhTempoLabel(
  status: Pick<TagihanStatus, "statusJatuhTempo" | "hariLewat" | "hariMenujuJatuhTempo">,
): string | null {
  if (status.statusJatuhTempo === "lewat_jatuh_tempo") return `Lewat ${status.hariLewat} hari`;
  if (status.statusJatuhTempo === "termin_belum_diatur") return "Termin belum diatur";
  if (status.statusJatuhTempo === "belum_jatuh_tempo") {
    return status.hariMenujuJatuhTempo === 0 ? "Jatuh tempo hari ini"
      : `Jatuh tempo ${status.hariMenujuJatuhTempo} hari lagi`;
  }
  return null;
}

/** Sub-baris sumber jatuh tempo; `null` ketika termin belum diatur. */
export function tagihanSumberJatuhTempoLabel(jatuhTempo: Pick<JatuhTempoTagihan, "sumber" | "terminHari">): string | null {
  if (jatuhTempo.sumber === "easymax") return "dari EasyMax";
  if (jatuhTempo.sumber === "belum_diatur") return null;
  return `termin ${jatuhTempo.terminHari} hari`;
}
