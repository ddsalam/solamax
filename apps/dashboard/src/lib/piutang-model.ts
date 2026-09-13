import type {
  SaldoSnapshot,
  SaldoSnapshotMetadata,
  SaldoSnapshotNotReadyReason,
  SaldoSnapshotRow,
} from "./saldo-snapshot";

export const PIUTANG_PAGE_SIZE = 50;

export const PIUTANG_FILTERS = ["semua", "bersaldo", "nol"] as const;
export const PIUTANG_SORTS = ["default", "nama", "kode"] as const;

export type PiutangFilter = (typeof PIUTANG_FILTERS)[number];
export type PiutangSort = (typeof PIUTANG_SORTS)[number];

export function isPiutangFilter(value: unknown): value is PiutangFilter {
  return typeof value === "string" && PIUTANG_FILTERS.some((candidate) => candidate === value);
}

export function isPiutangSort(value: unknown): value is PiutangSort {
  return typeof value === "string" && PIUTANG_SORTS.some((candidate) => candidate === value);
}

export interface PiutangViewInput {
  search?: string | null;
  filter?: string | null;
  sort?: string | null;
  pages?: Partial<Record<PiutangSectionId, string | number | null>>;
}

export interface PiutangViewRow extends SaldoSnapshotRow {
  /** Presentation-only predicate; it never adds or nets the three buckets. */
  isZeroBalance: boolean;
  bookCount: number;
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
  sections: PiutangPageSection[];
  occurrenceCount: number;
  zeroSectionOpen: boolean;
  filter: PiutangFilter;
  sort: PiutangSort;
  search: string;
}

export type PiutangView = PiutangNotReadyView | PiutangReadyView;

export interface PiutangExportView {
  sections: PiutangSection[];
  occurrenceCount: number;
  status: "ready";
  asOfDate: string;
  metadata: SaldoSnapshotMetadata;
  rows: PiutangViewRow[];
  hasOnlineCustomer: boolean;
  totalCount: number;
  resultCount: number;
  filter: PiutangFilter;
  sort: PiutangSort;
  search: string;
}

/** Fixed presentation order, shared by the screen and both export formats. */
export const PIUTANG_BOOKS = [
  { id: "lokal", title: "Piutang Lokal", awal: "awalPiutangLokal", akhir: "akhirPiutangLokal" },
  { id: "online", title: "Piutang Online", awal: "awalPiutangOnline", akhir: "akhirPiutangOnline" },
  { id: "hutang", title: "Hutang Lokal", awal: "awalHutangLokal", akhir: "akhirHutangLokal" },
] as const;

export type PiutangBook = (typeof PIUTANG_BOOKS)[number];
export type PiutangSectionId = PiutangBook["id"] | "nol";
export const PIUTANG_SECTION_IDS: readonly PiutangSectionId[] = [...PIUTANG_BOOKS.map((book) => book.id), "nol"];

export interface PiutangSection {
  id: PiutangSectionId;
  title: string;
  book: PiutangBook | null;
  rows: PiutangViewRow[];
}

export interface PiutangPageSection extends PiutangSection {
  page: number;
  totalPages: number;
  resultCount: number;
  pageSize: number;
}

export function piutangBookLabel(bookCount: number): string | null {
  return bookCount === 2 ? "satu pelanggan, dua buku"
    : bookCount === 3 ? "satu pelanggan, tiga buku" : null;
}

/** Rows are already filtered and sorted; membership never nets or rounds amounts. */
export function groupPiutangRows(rows: PiutangViewRow[], hasOnlineCustomer: boolean): PiutangSection[] {
  const sections: PiutangSection[] = PIUTANG_BOOKS
    .filter((book) => book.id !== "online" || hasOnlineCustomer)
    .map((book) => ({
      id: book.id,
      title: book.title,
      book,
      rows: rows.filter((row) => row[book.awal] !== 0 || row[book.akhir] !== 0),
    }));
  sections.push({ id: "nol", title: "Tanpa saldo di ketiga buku", book: null, rows: rows.filter((row) => row.isZeroBalance) });
  return sections;
}

const NOT_READY_COPY: Record<SaldoSnapshotNotReadyReason, { title: string; message: string }> = {
  no_published_snapshot: {
    title: "Data saldo belum siap",
    message: "Belum ada snapshot terpublikasi. Status pengiriman source cut dan pembangunan belum terlihat dari jalur baca ini. Angka saldo belum ditampilkan.",
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
  return {
    ...normalized,
    isZeroBalance: isZeroBalance(normalized),
    bookCount: PIUTANG_BOOKS.filter((book) => normalized[book.awal] !== 0 || normalized[book.akhir] !== 0).length,
  };
}

function normalizeFilter(value: string | null | undefined): PiutangFilter {
  return isPiutangFilter(value) ? value : "semua";
}

function normalizeSort(value: string | null | undefined): PiutangSort {
  return isPiutangSort(value) ? value : "default";
}

const PIUTANG_COLLATOR = new Intl.Collator("id-ID", { sensitivity: "base", numeric: true });

function compareText(left: string, right: string): number {
  return PIUTANG_COLLATOR.compare(left, right);
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

function selectRows(
  snapshot: Extract<SaldoSnapshot, { status: "ready" }>,
  input: PiutangViewInput,
) {
  const search = input.search?.trim() ?? "";
  const searchKey = search.toLocaleLowerCase("id-ID");
  const filter = normalizeFilter(input.filter);
  const sort = normalizeSort(input.sort);
  const normalizedRows = snapshot.rows.map(normalizeRow);
  const rows = normalizedRows.filter((row) => {
    const matchesSearch = searchKey.length === 0
      || row.customerCode.toLocaleLowerCase("id-ID").includes(searchKey)
      || (row.customerName?.toLocaleLowerCase("id-ID").includes(searchKey) ?? false);
    const matchesFilter = filter === "semua"
      || (filter === "nol" ? row.isZeroBalance : !row.isZeroBalance);
    return matchesSearch && matchesFilter;
  }).sort(compareRows(sort));
  return { search, filter, sort, normalizedRows, rows };
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

  const { search, filter, sort, normalizedRows, rows: filteredRows } = selectRows(snapshot, input);

  const groups = groupPiutangRows(filteredRows, snapshot.hasOnlineCustomer);
  const sections = groups.map((section): PiutangPageSection => {
    const totalPages = Math.max(1, Math.ceil(section.rows.length / PIUTANG_PAGE_SIZE));
    const page = normalizePage(input.pages?.[section.id], totalPages);
    const start = (page - 1) * PIUTANG_PAGE_SIZE;
    return { ...section, rows: section.rows.slice(start, start + PIUTANG_PAGE_SIZE),
      resultCount: section.rows.length, page, totalPages, pageSize: PIUTANG_PAGE_SIZE };
  });

  return {
    status: "ready",
    asOfDate: snapshot.asOfDate,
    metadata: snapshot.metadata,
    rows: filteredRows,
    sections,
    occurrenceCount: groups.reduce((count, section) => count + section.rows.length, 0),
    zeroSectionOpen: Boolean(search || filter === "nol" || input.pages?.nol != null),
    hasOnlineCustomer: snapshot.hasOnlineCustomer,
    totalCount: normalizedRows.length,
    resultCount: filteredRows.length,
    filter,
    sort,
    search,
  };
}

/** Same filter/search/sort contract as the screen, deliberately without pagination. */
export function buildPiutangExportView(
  snapshot: SaldoSnapshot,
  input: PiutangViewInput,
): PiutangNotReadyView | PiutangExportView {
  if (snapshot.status === "not_ready") return buildPiutangView(snapshot, input);
  const { search, filter, sort, normalizedRows, rows } = selectRows(snapshot, input);
  const sections = groupPiutangRows(rows, snapshot.hasOnlineCustomer);
  return {
    status: "ready",
    asOfDate: snapshot.asOfDate,
    metadata: snapshot.metadata,
    rows,
    sections,
    occurrenceCount: sections.reduce((count, section) => count + section.rows.length, 0),
    hasOnlineCustomer: snapshot.hasOnlineCustomer,
    totalCount: normalizedRows.length,
    resultCount: rows.length,
    filter,
    sort,
    search,
  };
}
