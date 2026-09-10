import type {
  SaldoSnapshot,
  SaldoSnapshotMetadata,
  SaldoSnapshotNotReadyReason,
  SaldoSnapshotRow,
} from "./saldo-snapshot";

export const PIUTANG_PAGE_SIZE = 50;

export type PiutangFilter = "semua" | "bersaldo" | "nol";
export type PiutangSort = "default" | "nama" | "kode";

export interface PiutangViewInput {
  search?: string | null;
  filter?: string | null;
  sort?: string | null;
  page?: string | number | null;
}

export interface PiutangViewRow extends SaldoSnapshotRow {
  /** Presentation-only predicate; it never adds or nets the three buckets. */
  isZeroBalance: boolean;
}

export interface PiutangNotReadyView {
  status: "not_ready";
  asOfDate: string;
  reason: SaldoSnapshotNotReadyReason;
  title: string;
  message: string;
  attemptedAt: string | null;
  failureSummary: string | null;
}

export interface PiutangReadyView {
  status: "ready";
  asOfDate: string;
  metadata: SaldoSnapshotMetadata;
  rows: PiutangViewRow[];
  hasOnlineCustomer: boolean;
  totalCount: number;
  resultCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filter: PiutangFilter;
  sort: PiutangSort;
  search: string;
}

export type PiutangView = PiutangNotReadyView | PiutangReadyView;

const NOT_READY_COPY: Record<SaldoSnapshotNotReadyReason, { title: string; message: string }> = {
  no_published_snapshot: {
    title: "Data saldo belum siap",
    message: "Unit ini masih menunggu pembaruan agent untuk mengirim source cut lengkap. Angka saldo belum ditampilkan.",
  },
  building_snapshot: {
    title: "Data saldo sedang disiapkan",
    message: "Source cut sudah diterima dan snapshot sedang dibangun. Angka saldo belum ditampilkan.",
  },
  failed_snapshot: {
    title: "Data saldo belum siap",
    message: "Pembuatan snapshot terakhir gagal. Laporkan unit, tanggal, dan waktu upaya terakhir kepada pengelola. Angka saldo belum ditampilkan.",
  },
  incomplete_snapshot: {
    title: "Data saldo belum siap",
    message: "Snapshot yang dipublikasikan tidak lolos pemeriksaan keutuhan. Laporkan unit dan tanggal kepada pengelola. Angka saldo belum ditampilkan.",
  },
};

const NUMERIC_KEYS = [
  "awalPiutangLokal",
  "akhirPiutangLokal",
  "awalPiutangOnline",
  "akhirPiutangOnline",
  "awalHutangLokal",
  "akhirHutangLokal",
] as const satisfies readonly (keyof SaldoSnapshotRow)[];

function isZeroBalance(row: SaldoSnapshotRow): boolean {
  return NUMERIC_KEYS.every((key) => row[key] === 0);
}

function normalizeRow(row: SaldoSnapshotRow): PiutangViewRow {
  const normalized = {
    ...row,
    customerCode: row.customerCode.trim(),
    customerName: row.customerName?.trim() || null,
  };
  return { ...normalized, isZeroBalance: isZeroBalance(normalized) };
}

function normalizeFilter(value: string | null | undefined): PiutangFilter {
  return value === "bersaldo" || value === "nol" ? value : "semua";
}

function normalizeSort(value: string | null | undefined): PiutangSort {
  return value === "nama" || value === "kode" ? value : "default";
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "id-ID", { sensitivity: "base", numeric: true });
}

function compareNameThenCode(left: PiutangViewRow, right: PiutangViewRow): number {
  const leftName = left.customerName ?? left.customerCode;
  const rightName = right.customerName ?? right.customerCode;
  return compareText(leftName, rightName) || compareText(left.customerCode, right.customerCode);
}

function compareRows(sort: PiutangSort): (left: PiutangViewRow, right: PiutangViewRow) => number {
  if (sort === "kode") return (left, right) => compareText(left.customerCode, right.customerCode);
  if (sort === "nama") return compareNameThenCode;
  return (left, right) => Number(left.isZeroBalance) - Number(right.isZeroBalance)
    || compareNameThenCode(left, right);
}

function normalizePage(value: string | number | null | undefined, totalPages: number): number {
  const parsed = typeof value === "number"
    ? (Number.isInteger(value) ? value : 1)
    : typeof value === "string" && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : 1;
  return Math.min(Math.max(parsed, 1), totalPages);
}

/** Pure presentation boundary: no database reads and no derived cross-bucket amount. */
export function buildPiutangView(snapshot: SaldoSnapshot, input: PiutangViewInput): PiutangView {
  if (snapshot.status === "not_ready") {
    const copy = NOT_READY_COPY[snapshot.reason];
    return {
      status: "not_ready",
      asOfDate: snapshot.asOfDate,
      reason: snapshot.reason,
      ...copy,
      attemptedAt: snapshot.latestAttempt?.attemptedAt ?? null,
      failureSummary: snapshot.latestAttempt?.failureSummary ?? null,
    };
  }

  const search = input.search?.trim() ?? "";
  const searchKey = search.toLocaleLowerCase("id-ID");
  const filter = normalizeFilter(input.filter);
  const sort = normalizeSort(input.sort);
  const normalizedRows = snapshot.rows.map(normalizeRow);
  const filteredRows = normalizedRows.filter((row) => {
    const matchesSearch = searchKey.length === 0
      || row.customerCode.toLocaleLowerCase("id-ID").includes(searchKey)
      || (row.customerName?.toLocaleLowerCase("id-ID").includes(searchKey) ?? false);
    const matchesFilter = filter === "semua"
      || (filter === "nol" ? row.isZeroBalance : !row.isZeroBalance);
    return matchesSearch && matchesFilter;
  }).sort(compareRows(sort));

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PIUTANG_PAGE_SIZE));
  const page = normalizePage(input.page, totalPages);
  const start = (page - 1) * PIUTANG_PAGE_SIZE;

  return {
    status: "ready",
    asOfDate: snapshot.asOfDate,
    metadata: snapshot.metadata,
    rows: filteredRows.slice(start, start + PIUTANG_PAGE_SIZE),
    hasOnlineCustomer: snapshot.hasOnlineCustomer,
    totalCount: normalizedRows.length,
    resultCount: filteredRows.length,
    page,
    pageSize: PIUTANG_PAGE_SIZE,
    totalPages,
    filter,
    sort,
    search,
  };
}
