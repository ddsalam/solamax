import {
  PIUTANG_SECTION_IDS,
  isPiutangFilter,
  isPiutangSort,
  type PiutangReadyView,
  type PiutangSectionId,
  type PiutangViewInput,
} from "./piutang-model";
import { rp } from "./format";
import type { SaldoFreshness } from "./saldo-freshness";
import type { SaldoSnapshot } from "./saldo-snapshot";

export function piutangViewInput(params: Record<string, string | string[] | undefined>): PiutangViewInput {
  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  return {
    search: one(params.q), filter: one(params.filter), sort: one(params.sort),
    pages: Object.fromEntries(PIUTANG_SECTION_IDS.map((id) => [id, one(params[`page_${id}`])])),
  };
}

/** Section navigation retains every other section page; filter changes omit all pages. */
export function piutangQueryHref(
  input: Pick<PiutangReadyView, "search" | "filter" | "sort">,
  pages: Partial<Record<PiutangSectionId, number>> = {},
  sectionId?: PiutangSectionId,
): string {
  const params = new URLSearchParams();
  if (input.search) params.set("q", input.search);
  params.set("filter", input.filter);
  params.set("sort", input.sort);
  for (const id of PIUTANG_SECTION_IDS) {
    if (pages[id] !== undefined) params.set(`page_${id}`, String(pages[id]));
  }
  return `?${params}${sectionId ? `#piutang-${sectionId}` : ""}`;
}

/** Export handlers reject unknown enum values rather than silently normalising them. */
export function validPiutangExportInput(params: URLSearchParams): PiutangViewInput | null {
  const filter = params.get("filter");
  const sort = params.get("sort");
  if (filter !== null && !isPiutangFilter(filter)) return null;
  if (sort !== null && !isPiutangSort(sort)) return null;
  return { search: params.get("q"), filter, sort };
}

export function piutangExportHref(
  format: "csv" | "pdf",
  unitCode: string,
  date: string,
  input: Pick<PiutangReadyView, "search" | "filter" | "sort">,
): string {
  const params = new URLSearchParams();
  if (input.search) params.set("q", input.search);
  params.set("filter", input.filter);
  params.set("sort", input.sort);
  return `/api/keuangan/unit/${encodeURIComponent(unitCode)}/piutang/${date}/${format}?${params}`;
}

export function formatWib(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Pontianak",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso)) + " WIB";
}

export interface PiutangPendingBanner {
  tone: "warning" | "danger";
  title: string;
  body: string;
}

/**
 * ⚠️ LUBANG YANG DITUTUP DI SINI (F1). Versi lama hanya menyala saat pointer
 * ber-`pending_replacement`, dan tanda itu hanya dipasang ketika ada cut
 * `complete` BARU — sekali sehari, 02:05 WIB. Pada 13-09-2026 koreksi mundur
 * masuk 08:34/08:38 dan layar meleset **Rp 35.979.362** selama ±18 jam tanpa
 * satu pun indikator; banner yang sudah dibangun tidak mungkin muncul.
 *
 * `freshness` mengukur perubahan pasca-cut yang BENAR-BENAR mengubah angka
 * tanggal ini (materialitas, bukan watermark). Ia diutamakan karena ia
 * menyebutkan RUPIAHNYA — yang membuat pembaca tahu seberapa jauh melesetnya,
 * bukan sekadar bahwa ada sesuatu.
 */
export function pendingBanner(
  snapshot: Extract<SaldoSnapshot, { status: "ready" }>,
  freshness?: SaldoFreshness,
): PiutangPendingBanner | undefined {
  if (freshness?.material) {
    return {
      tone: "warning",
      title: `Ada perubahan sesudah snapshot ${formatWib(snapshot.metadata.sourceCompletedAt)}—selisih ${rp(freshness.totalAbsolut)}`,
      body: "Angka di layar berasal dari snapshot itu; buku besar yang hidup sudah berbeda sebanyak selisih di atas. Snapshot berikutnya akan memuatnya.",
    };
  }
  if (!snapshot.metadata.pendingReplacement) return undefined;
  const failed = snapshot.latestAttempt?.status === "failed";
  return {
    tone: failed ? "danger" : "warning",
    title: `${failed ? "Pembaruan gagal" : "Data sedang diperbarui"}—menampilkan snapshot aktif dari ${formatWib(snapshot.metadata.sourceCompletedAt)}`,
    body: failed
      ? "Generasi lengkap sebelumnya tetap aktif. Laporkan unit, tanggal, dan waktu upaya terakhir kepada pengelola."
      : "Generasi lengkap sebelumnya tetap aktif sampai publikasi baru selesai.",
  };
}

export function readinessProps(snapshot: Extract<SaldoSnapshot, { status: "not_ready" }>) {
  const building = snapshot.reason === "building_snapshot";
  const failed = snapshot.reason === "failed_snapshot" || snapshot.reason === "incomplete_snapshot";
  return {
    kind: building ? "building" as const : failed ? "failed" as const : "missing" as const,
    title: building ? "Data saldo sedang disiapkan" : "Data saldo belum siap",
    reason: snapshot.reason === "no_published_snapshot"
      ? "Belum ada snapshot terpublikasi untuk unit serta tanggal ini. Status pengiriman source cut dan pembangunan belum terlihat dari jalur baca ini."
      : snapshot.reason === "building_snapshot"
        ? "Source cut sudah diterima dan snapshot tanggal ini sedang dibangun."
        : snapshot.reason === "failed_snapshot"
          ? `Pembuatan snapshot terakhir gagal${snapshot.latestAttempt?.failureSummary ? `: ${snapshot.latestAttempt.failureSummary}` : "."}`
          : "Generasi yang ditemukan tidak lolos pemeriksaan jumlah baris atau checksum.",
    action: snapshot.reason === "no_published_snapshot"
      ? "Periksa kembali setelah siklus agent dan worker berikutnya, atau minta pengelola memeriksa status pipeline; jangan menganggapnya saldo nol."
      : snapshot.reason === "building_snapshot"
        ? "Tunggu worker menyelesaikan dan mempublikasikan generasi lengkap."
        : "Laporkan unit, tanggal, dan waktu upaya terakhir kepada pengelola; jangan menganggapnya saldo nol.",
    ...(snapshot.latestAttempt?.attemptedAt ? { lastAttemptLabel: formatWib(snapshot.latestAttempt.attemptedAt) } : {}),
  };
}

/**
 * Indikator pergerakan angka pada tanggal BEKU.
 *
 * ⚠️ BEDA DENGAN `pendingBanner`, dan bedanya penting. `pendingBanner` bicara
 * soal angka yang SEDANG atau AKAN berubah. Ini bicara soal angka yang SUDAH
 * berubah pada tanggal yang seharusnya tidak lagi bergerak — dan ia tidak padam
 * karena waktu, hanya karena ada manusia yang mengakuinya.
 *
 * ⛔ Keadaan `frozen` tidak dihitung ulang di sini; ia dibaca dari peristiwa,
 * yang membekukannya memakai definisi tunggal G5 saat perekaman.
 */
export interface PiutangShiftNotice {
  tone: "warning" | "info";
  title: string;
  body: string;
  /** Peristiwa yang menunggu pengakuan pemilik; kosong = tidak ada tombol. */
  menunggu: Array<{ generationId: string; selisihAbsolut: number }>;
}

export function shiftNotice(
  shifts: Array<{
    frozen: boolean;
    acknowledged: boolean;
    acknowledgedBy: string | null;
    generationId: string;
    geserPiutangLokal: number;
    geserPiutangOnline: number;
    geserHutangLokal: number;
  }>,
): PiutangShiftNotice | undefined {
  const beku = shifts.filter((s) => s.frozen);
  if (beku.length === 0) return undefined;

  const absolut = (s: (typeof beku)[number]) =>
    Math.abs(s.geserPiutangLokal) + Math.abs(s.geserPiutangOnline) + Math.abs(s.geserHutangLokal);

  const menunggu = beku.filter((s) => !s.acknowledged);
  if (menunggu.length === 0) {
    const pengaku = beku.find((s) => s.acknowledgedBy)?.acknowledgedBy ?? "pemilik";
    return {
      tone: "info",
      title: `Angka tanggal ini pernah berubah sesudah terbit—sudah diperiksa dan disetujui`,
      body: `${beku.length} pergeseran tercatat pada tanggal ini. Terakhir diakui oleh ${pengaku}. Jika angkanya bergerak lagi, tanda ini akan memerah kembali.`,
      menunggu: [],
    };
  }

  const total = menunggu.reduce((sum, s) => sum + absolut(s), 0);
  return {
    tone: "warning",
    title: `Angka tanggal ini BERUBAH sesudah terbit—selisih ${rp(total)} belum diakui`,
    body:
      menunggu.length === 1
        ? "Tanggal ini sudah di luar jendela pembaruan wajar, tetapi angkanya bergerak karena koreksi di sumber. Perubahan itu sah; yang belum ada adalah pengakuan bahwa ia sudah diperiksa."
        : `${menunggu.length} pergeseran pada tanggal ini belum diakui. Semuanya di luar jendela pembaruan wajar.`,
    menunggu: menunggu.map((s) => ({ generationId: s.generationId, selisihAbsolut: absolut(s) })),
  };
}

/**
 * Label satu KOREKSI untuk tombol pengakuannya.
 *
 * ⚠️ Label ini WAJIB menyebut JUMLAH tanggal, dan tanggalnya sendiri wajib
 * ditampilkan di sebelahnya. Tombol yang hanya berbunyi "setujui koreksi ini"
 * menyembunyikan cakupannya, dan pengakuan yang cakupannya tersembunyi adalah
 * persetujuan borongan senyap dengan nama lain.
 */
export function shiftGroupLabel(group: {
  sourceCycleSequence: string;
  peristiwa: Array<{ asOfDate: string }>;
  selisihAbsolut: number;
}): string {
  const n = group.peristiwa.length;
  return `Koreksi cut ${group.sourceCycleSequence} — ${n} tanggal, selisih ${rp(group.selisihAbsolut)}`;
}

/** Tanggal yang dicakup satu koreksi, untuk ditampilkan SEBELUM tombol ditekan. */
export function shiftGroupDates(group: { peristiwa: Array<{ asOfDate: string }> }): string {
  return group.peristiwa.map((p) => p.asOfDate).join(" · ");
}
