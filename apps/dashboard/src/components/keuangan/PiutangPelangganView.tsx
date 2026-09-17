import { rp } from "@/lib/format";
import {
  PIUTANG_BOOKS,
  piutangBookTotalAmounts,
  PIUTANG_PAGE_SIZE,
  PIUTANG_FILTERS,
  piutangBookLabel,
  piutangBookAmounts,
  booksForPiutangRow,
  type PiutangBookAmounts,
  type PiutangBoundaryAmounts,
  type PiutangPageSection,
  PIUTANG_SORTS,
  type PiutangFilter,
  type PiutangSort,
} from "@/lib/piutang-model";
import {
  piutangQueryHref,
  type PiutangPendingBanner,
  type PiutangShiftNotice,
} from "@/lib/piutang-route";

import type { SaldoSnapshotMetadata } from "@/lib/saldo-snapshot";

export interface PiutangQueryState {
  search: string;
  filter: PiutangFilter;
  sort: PiutangSort;
  totalRows: number;
  occurrenceCount: number;
}

interface PiutangCommonProps {
  unit: { code: string; name: string };
  date: string;
  /** `/keuangan/unit/[code]/piutang/[date]/pelanggan` tanpa kode pelanggan. */
  detailBaseUrl: string;
}

export type PiutangPelangganViewProps =
  | (PiutangCommonProps & {
      state: "ready";
      hasOnlineCustomer: boolean;
      query: PiutangQueryState;
      provenance: {
        formulaVersion: string;
        computedAtLabel: string;
        sourceCutLabel: string;
      };
      summary: Pick<SaldoSnapshotMetadata, "totals" | "debetTotals" | "kreditTotals">;
      sections: PiutangPageSection[];
      zeroSectionOpen: boolean;
      csvHref: string;
      pdfHref: string;
      pendingBanner?: PiutangPendingBanner;
      /** Pergerakan angka pada tanggal BEKU; lihat `shiftNotice`. */
      shiftNotice?: PiutangShiftNotice;
      /** Hanya pemilik (super_admin) yang menerima tombol pengakuan. */
      shiftAck?: {
        code: string;
        asOfDate: string;
        action: (formData: FormData) => Promise<void>;
      };
      historicalNote?: string | null;
    })
  | (PiutangCommonProps & {
      state: "not_ready";
      readiness: {
        kind: "missing" | "building" | "failed";
        title: string;
        reason: string;
        action: string;
        lastAttemptLabel?: string;
      };
    });

const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

const PIUTANG_FILTER_LABELS: Record<PiutangFilter, string> = {
  semua: "Semua",
  bersaldo: "Bersaldo",
  nol: "Saldo nol",
};

const PIUTANG_SORT_LABELS: Record<PiutangSort, string> = {
  default: "Nama A–Z per buku",
  nama: "Nama A–Z",
  kode: "Kode A–Z",
};

const RUPIAH_NUMBER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

const tanggalPanjang = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day || BULAN[month - 1] === undefined) return iso;
  return `${day} ${BULAN[month - 1]} ${year}`;
};

/** Tanda ledger dipertahankan; nol sengaja rapat menjadi `Rp0` sesuai rancangan. */
const rupiah = (amount: number): string => {
  const value = Math.round(amount) || 0;
  if (value === 0) return "Rp0";
  const magnitude = RUPIAH_NUMBER.format(Math.abs(value));
  return value < 0 ? `−Rp ${magnitude}` : `Rp ${magnitude}`;
};

const DEBET_KREDIT_NUMBER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
const rupiahPrecise = (value: number): string => value === 0 ? "Rp0"
  : `${value < 0 ? "−" : ""}Rp ${DEBET_KREDIT_NUMBER.format(Math.abs(value))}`;

function Nilai({ value, format = rupiah }: { value: number; format?: (value: number) => string }) {
  return (
    <span className={`b6-piutang-value num${value < 0 ? " t-danger" : ""}`} data-piutang-numeric>
      {format(value)}
    </span>
  );
}

function BoundaryAmounts({ amounts, saldoFormat = rupiah }: {
  amounts: PiutangBoundaryAmounts;
  saldoFormat?: (value: number) => string;
}) {
  return <dl className="b6-piutang-triplet">
    <div><dt>Debet</dt><dd><Nilai value={amounts.debet} format={rupiahPrecise} /></dd></div>
    <div><dt>Kredit</dt><dd><Nilai value={amounts.kredit} format={rupiahPrecise} /></dd></div>
    <div className="b6-piutang-saldo"><dt>Saldo</dt><dd><Nilai value={amounts.saldo} format={saldoFormat} /></dd></div>
  </dl>;
}

function BucketPair({ name, amounts }: { name: string; amounts: PiutangBookAmounts }) {
  return (
    <div className="b6-piutang-bucket" role="cell">
      <div className="b6-piutang-bucket-name">{name}</div>
      <div className="b6-piutang-pair">
        <div><span className="b6-piutang-mobile-bound">Awal</span><BoundaryAmounts amounts={amounts.awal} /></div>
        <div><span className="b6-piutang-mobile-bound">Akhir</span><BoundaryAmounts amounts={amounts.akhir} /></div>
      </div>
    </div>
  );
}

function HeaderBucket({ name }: { name: string }) {
  return (
    <div className="b6-piutang-head-bucket" role="columnheader">
      <strong>{name}</strong>
      <div className="b6-piutang-head-pair">
        <span><b>Awal</b><small>dtgl &lt; D · s.d. D−1</small></span>
        <span><b>Akhir</b><small>dtgl ≤ D · s.d. D</small></span>
      </div>
    </div>
  );
}

export function PiutangSummaryBucket({ name, amounts, saldoFormat }: {
  name: string;
  amounts: PiutangBookAmounts;
  saldoFormat?: (value: number) => string;
}) {
  return (
    <section className="card b6-piutang-summary-card" aria-label={`Ringkasan ${name}`}>
      <h3>{name}</h3>
      <div className="b6-piutang-summary-pair">
        <div><span>Awal · dtgl &lt; D · s.d. D−1</span><BoundaryAmounts amounts={amounts.awal} saldoFormat={saldoFormat} /></div>
        <div><span>Akhir · dtgl ≤ D · s.d. D</span><BoundaryAmounts amounts={amounts.akhir} saldoFormat={saldoFormat} /></div>
      </div>
    </section>
  );
}

function NotReady({ props }: { props: Extract<PiutangPelangganViewProps, { state: "not_ready" }> }) {
  const kindLabel = {
    missing: "Belum ada snapshot lengkap",
    building: "Pembangunan sedang berjalan",
    failed: "Pembangunan terakhir gagal",
  }[props.readiness.kind];

  return (
    <section className="b6-piutang-not-ready na-panel" aria-labelledby="b6-piutang-not-ready-title">
      <span className={`b6-piutang-state-tag ${props.readiness.kind}`}>{kindLabel}</span>
      <h2 id="b6-piutang-not-ready-title">{props.readiness.title}</h2>
      <p>
        SPBU {props.unit.code} · {props.unit.name} · {tanggalPanjang(props.date)}
      </p>
      <p>{props.readiness.reason}</p>
      {props.readiness.lastAttemptLabel && (
        <p className="t-tertiary">Upaya terakhir: {props.readiness.lastAttemptLabel}</p>
      )}
      <div className="banner info b6-piutang-next-step">
        <span className="dot info" aria-hidden="true" />
        <div>
          <strong>Agar data siap</strong>
          <p>{props.readiness.action}</p>
        </div>
      </div>
      <p className="b6-piutang-not-zero">
        Belum siap bukan berarti saldo nol. Angka baru ditampilkan setelah snapshot lengkap dipublikasikan.
      </p>
    </section>
  );
}

function Controls({ props }: { props: Extract<PiutangPelangganViewProps, { state: "ready" }> }) {
  const { query } = props;
  return (
    <div className="b6-piutang-controls no-print" aria-label="Cari dan saring pelanggan">
      <form method="get" className="b6-piutang-search">
        <input type="hidden" name="filter" value={query.filter} />
        <input type="hidden" name="sort" value={query.sort} />
        <label htmlFor="b6-piutang-q">Cari kode atau nama pelanggan</label>
        <div>
          <input id="b6-piutang-q" name="q" type="search" defaultValue={query.search} />
          <button type="submit" className="btn-outline">
            Cari
          </button>
        </div>
      </form>

      <nav className="seg b6-piutang-balance-filter" aria-label="Filter saldo">
        {PIUTANG_FILTERS.map((value) => (
          <a
            key={value}
            href={piutangQueryHref({ ...query, filter: value })}
            className={`seg-btn${query.filter === value ? " active" : ""}`}
            aria-current={query.filter === value ? "page" : undefined}
          >
            {PIUTANG_FILTER_LABELS[value]}
          </a>
        ))}
      </nav>

      <form method="get" className="b6-piutang-sort">
        {query.search && <input type="hidden" name="q" value={query.search} />}
        <input type="hidden" name="filter" value={query.filter} />
        <label htmlFor="b6-piutang-sort">Urutkan</label>
        <select id="b6-piutang-sort" name="sort" defaultValue={query.sort}>
          {PIUTANG_SORTS.map((value) => (
            <option key={value} value={value}>{PIUTANG_SORT_LABELS[value]}</option>
          ))}
        </select>
        <button type="submit" className="btn-outline">
          Terapkan
        </button>
      </form>
    </div>
  );
}

function SectionLedger({
  section,
  detailBaseUrl,
}: {
  section: PiutangPageSection;
  detailBaseUrl: string;
}) {
  const books = section.book ? [section.book] : PIUTANG_BOOKS;
  const stackedBooks = !section.book || section.rows.some((row) => booksForPiutangRow(section, row).length > 1);
  const columns = stackedBooks ? "zero-books" : "single-book";
  if (section.rows.length === 0) return (
    <div className="empty-inline b6-piutang-empty">Tidak ada pelanggan yang cocok dengan pencarian dan filter ini.</div>
  );
  return (
    <div className={`b6-piutang-ledger ${columns}`} role="table" aria-label={section.title}>
      <div className={`b6-piutang-ledger-head ${columns}`} role="row">
        <div className="b6-piutang-customer-head" role="columnheader">Pelanggan</div>
        {books.map((book) => <HeaderBucket key={book.id} name={book.title} />)}
      </div>
      <div role="rowgroup">
        {section.rows.map((row) => {
          const bookLabel = piutangBookLabel(row.bookCount);
          return (
          <div className={`b6-piutang-ledger-row ${columns}${row.isZeroBalance ? " is-zero" : ""}`} role="row" key={row.customerCode}>
            <div className="b6-piutang-customer" role="rowheader">
              <a href={`${detailBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(row.customerCode.trim())}`}>
                {row.customerName || "Nama belum tersedia"}
              </a>
              <span className="mono">{row.customerCode}</span>
              {row.isZeroBalance && <span className="b6-piutang-zero-badge">Saldo nol pada kedua batas</span>}
              {bookLabel && <span className="b6-piutang-book-badge">{bookLabel}</span>}
            </div>
            {booksForPiutangRow(section, row).map((book) => (
              <BucketPair key={book.id} name={`${book.title}${section.book && book.id !== section.book.id ? " · buku bersaldo nol" : ""}`} amounts={piutangBookAmounts(row, book)} />
            ))}
          </div>
        ); })}
      </div>
    </div>
  );
}

function Pagination({ section, props }: {
  section: PiutangPageSection;
  props: Extract<PiutangPelangganViewProps, { state: "ready" }>;
}) {
  if (section.totalPages <= 1) return null;
  const pages = Object.fromEntries(props.sections
    .filter((s) => s.id !== "nol" || props.zeroSectionOpen)
    .map((s) => [s.id, s.page]));
  const href = (page: number) => piutangQueryHref(props.query, { ...pages, [section.id]: page }, section.id);
  return (
    <nav className="b6-piutang-pagination no-print" aria-label={`Halaman ${section.title}`}>
      {section.page > 1 ? <a className="btn-outline" rel="prev" href={href(section.page - 1)}>← Sebelumnya</a> : <span />}
      <span>Halaman {section.page} dari {section.totalPages}</span>
      {section.page < section.totalPages ? <a className="btn-outline" rel="next" href={href(section.page + 1)}>Berikutnya →</a> : <span />}
    </nav>
  );
}

function CustomerLedger({ props }: { props: Extract<PiutangPelangganViewProps, { state: "ready" }> }) {
  return (
    <div className="b6-piutang-sections">
      <p className="b6-piutang-result-count">
        {props.query.totalRows.toLocaleString("id-ID")} pelanggan unik · {props.query.occurrenceCount.toLocaleString("id-ID")} kemunculan dalam seksi · {PIUTANG_PAGE_SIZE} per halaman per seksi
      </p>
      {props.sections.map((section) => {
        const title = (
          <div className="b6-piutang-list-meta">
            <div>
              <h2 id={`piutang-${section.id}-title`}>{section.title}</h2>
              <p>{section.resultCount.toLocaleString("id-ID")} pelanggan · {section.pageSize} per halaman</p>
            </div>
            {section.id === "nol" && <span>Buka atau tutup daftar pelanggan tanpa saldo</span>}
          </div>
        );
        const body = <><SectionLedger section={section} detailBaseUrl={props.detailBaseUrl} /><Pagination section={section} props={props} /></>;
        return section.id === "nol" ? (
          <details className="card b6-piutang-list b6-piutang-zero-section" id="piutang-nol" key={section.id} open={props.zeroSectionOpen}>
            <summary>{title}</summary>
            {body}
          </details>
        ) : (
          <section className="card b6-piutang-list" id={`piutang-${section.id}`} key={section.id} aria-labelledby={`piutang-${section.id}-title`}>
            {title}{body}
          </section>
        );
      })}
    </div>
  );
}

export function PiutangPelangganView(props: PiutangPelangganViewProps) {
  return (
    <div className="b6-piutang-page">
      <header className="b6-piutang-heading">
        <div>
          <div className="text-eyebrow t-tertiary">Keuangan · Saldo pelanggan</div>
          <h1 className="text-h3 t-brand">Daftar Saldo Hutang Piutang per Pelanggan</h1>
          <p>
            SPBU {props.unit.code} · {props.unit.name} · {tanggalPanjang(props.date)}
          </p>
        </div>
        {props.state === "ready" && (
          <div className="b6-piutang-exports no-print" aria-label="Ekspor seluruh hasil filter">
            <a className="btn-tint" href={props.pdfHref}>
              Unduh PDF
            </a>
            <a className="btn-outline" href={props.csvHref}>
              Ekspor CSV
            </a>
          </div>
        )}
      </header>

      {props.state === "not_ready" ? (
        <NotReady props={props} />
      ) : (
        <>
          {props.pendingBanner && (
            <div className={`banner ${props.pendingBanner.tone} b6-piutang-pending`} role="status">
              <span className={`dot ${props.pendingBanner.tone}`} aria-hidden="true" />
              <div>
                <strong>{props.pendingBanner.title}</strong>
                <p>{props.pendingBanner.body}</p>
              </div>
            </div>
          )}

          {props.shiftNotice && (
            <div
              className={`banner ${props.shiftNotice.tone} b6-piutang-shift`}
              role={props.shiftNotice.tone === "warning" ? "alert" : "status"}
            >
              <span className={`dot ${props.shiftNotice.tone}`} aria-hidden="true" />
              <div>
                <strong>{props.shiftNotice.title}</strong>
                <p>{props.shiftNotice.body}</p>
                {/* Tombolnya hanya ada bila pemanggilnya pemilik DAN masih ada
                    yang menunggu. Wewenangnya tetap ditegakkan di server —
                    ketiadaan tombol bukan penjaganya. Satu tombol per
                    peristiwa: tidak ada "setujui semua". */}
                {props.shiftAck &&
                  props.shiftNotice.menunggu.map((m) => (
                    <form key={m.generationId} action={props.shiftAck!.action}>
                      <input type="hidden" name="code" value={props.shiftAck!.code} />
                      <input type="hidden" name="as_of_date" value={props.shiftAck!.asOfDate} />
                      <input type="hidden" name="generation_id" value={m.generationId} />
                      <button className="btn-outline" type="submit">
                        Diketahui &amp; disetujui — {rp(m.selisihAbsolut)}
                      </button>
                    </form>
                  ))}
              </div>
            </div>
          )}

          <PiutangHistoricalNote note={props.historicalNote} />
          <aside className="banner info b6-piutang-rule" aria-label="Aturan membaca bucket">
            <span className="dot info" aria-hidden="true" />
            <strong>Tiga bucket berbeda; jangan dijumlahkan atau dinetokan.</strong>
          </aside>

          <section className={`b6-piutang-summaries${props.hasOnlineCustomer ? " has-online" : ""}`} aria-label="Ringkasan per bucket">
            {PIUTANG_BOOKS.filter((book) => book.id !== "online" || props.hasOnlineCustomer).map((book) => (
              <PiutangSummaryBucket key={book.id} name={book.title} amounts={piutangBookTotalAmounts(props.summary, book)} />
            ))}
          </section>

          <p className="t-secondary">Debet/Kredit adalah akumulasi transaksi pada setiap batas tanggal. Buku bersaldo nol dengan Debet/Kredit tetap ditampilkan pada seksi aktif pertama pelanggan.</p>
          <div className="b6-piutang-provenance">
            <span>Formula {props.provenance.formulaVersion}</span>
            <span>Dihitung {props.provenance.computedAtLabel}</span>
            <span>{props.provenance.sourceCutLabel}</span>
          </div>

          <Controls props={props} />
          <CustomerLedger props={props} />
        </>
      )}
    </div>
  );
}

export function PiutangHistoricalNote({ note }: { note: string | null | undefined }) {
  if (!note) return null;
  return <aside className="banner info" aria-label="Tentang tanggal historis">
    <span className="dot info" aria-hidden="true" />
    <div><strong>Posisi historis dari data terbaru</strong><p>{note}</p></div>
  </aside>;
}
