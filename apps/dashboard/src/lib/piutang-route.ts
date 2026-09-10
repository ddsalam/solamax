import {
  isPiutangFilter,
  isPiutangSort,
  type PiutangReadyView,
  type PiutangViewInput,
  type PiutangViewRow,
} from "./piutang-model";
import type { SaldoSnapshot, SaldoSnapshotRow } from "./saldo-snapshot";

export function piutangViewInput(params: Record<string, string | string[] | undefined>): PiutangViewInput {
  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  return { search: one(params.q), filter: one(params.filter), sort: one(params.sort), page: one(params.page) };
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

export function balanceSetFromRow(row: PiutangViewRow | SaldoSnapshotRow) {
  return {
    piutangLokalAwal: row.awalPiutangLokal,
    piutangLokalAkhir: row.akhirPiutangLokal,
    piutangOnlineAwal: row.awalPiutangOnline,
    piutangOnlineAkhir: row.akhirPiutangOnline,
    hutangLokalAwal: row.awalHutangLokal,
    hutangLokalAkhir: row.akhirHutangLokal,
  };
}

export function balanceSetFromTotals(view: PiutangReadyView) {
  return {
    piutangLokalAwal: view.metadata.totals.awal.piutangLokal,
    piutangLokalAkhir: view.metadata.totals.akhir.piutangLokal,
    piutangOnlineAwal: view.metadata.totals.awal.piutangOnline,
    piutangOnlineAkhir: view.metadata.totals.akhir.piutangOnline,
    hutangLokalAwal: view.metadata.totals.awal.hutangLokal,
    hutangLokalAkhir: view.metadata.totals.akhir.hutangLokal,
  };
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

export function pendingBanner(
  snapshot: Extract<SaldoSnapshot, { status: "ready" }>,
): PiutangPendingBanner | undefined {
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
