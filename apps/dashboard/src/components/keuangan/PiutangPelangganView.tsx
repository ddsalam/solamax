export interface PiutangBalanceSet {
  piutangLokalAwal: number;
  piutangLokalAkhir: number;
  piutangOnlineAwal: number;
  piutangOnlineAkhir: number;
  hutangLokalAwal: number;
  hutangLokalAkhir: number;
}

export interface PiutangCustomerRow {
  customerCode: string;
  customerName: string;
  balances: PiutangBalanceSet;
}

export interface PiutangQueryState {
  search: string;
  balance: "all" | "nonzero" | "zero";
  sort: "default" | "name" | "code";
  page: number;
  pageSize: 50;
  totalRows: number;
  totalPages: number;
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
      totals: PiutangBalanceSet;
      rows: PiutangCustomerRow[];
      csvHref: string;
      pdfHref: string;
      pendingBanner?: {
        tone: "warning" | "danger";
        title: string;
        body: string;
      };
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

const tanggalPanjang = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day || BULAN[month - 1] === undefined) return iso;
  return `${day} ${BULAN[month - 1]} ${year}`;
};

/** Tanda ledger dipertahankan; nol sengaja rapat menjadi `Rp0` sesuai rancangan. */
const rupiah = (amount: number): string => {
  const value = Math.round(amount) || 0;
  if (value === 0) return "Rp0";
  const magnitude = Math.abs(value).toLocaleString("id-ID", { maximumFractionDigits: 0 });
  return value < 0 ? `−Rp ${magnitude}` : `Rp ${magnitude}`;
};

const semuaNol = (balances: PiutangBalanceSet): boolean =>
  Object.values(balances).every((value) => (Math.round(value) || 0) === 0);

const queryHref = (
  query: PiutangQueryState,
  changes: Partial<Pick<PiutangQueryState, "search" | "balance" | "sort" | "page">>,
): string => {
  const next = { ...query, ...changes };
  const params = new URLSearchParams();
  if (next.search) params.set("q", next.search);
  params.set("balance", next.balance);
  params.set("sort", next.sort);
  params.set("page", String(next.page));
  return `?${params.toString()}`;
};

function Nilai({ value }: { value: number }) {
  return (
    <span className={`b6-piutang-value num${value < 0 ? " t-danger" : ""}`} data-piutang-numeric>
      {rupiah(value)}
    </span>
  );
}

function BucketPair({
  name,
  awal,
  akhir,
  role = "cell",
}: {
  name: string;
  awal: number;
  akhir: number;
  role?: "cell" | "presentation";
}) {
  return (
    <div className="b6-piutang-bucket" role={role}>
      <div className="b6-piutang-bucket-name">{name}</div>
      <div className="b6-piutang-pair">
        <div>
          <span className="b6-piutang-mobile-bound">Awal</span>
          <Nilai value={awal} />
        </div>
        <div>
          <span className="b6-piutang-mobile-bound">Akhir</span>
          <Nilai value={akhir} />
        </div>
      </div>
    </div>
  );
}

function HeaderBucket({ name }: { name: string }) {
  return (
    <div className="b6-piutang-head-bucket" role="columnheader">
      <strong>{name}</strong>
      <div className="b6-piutang-head-pair">
        <span>
          <b>Awal</b>
          <small>dtgl &lt; D · s.d. D−1</small>
        </span>
        <span>
          <b>Akhir</b>
          <small>dtgl ≤ D · s.d. D</small>
        </span>
      </div>
    </div>
  );
}

function RingkasanBucket({
  name,
  awal,
  akhir,
}: {
  name: string;
  awal: number;
  akhir: number;
}) {
  return (
    <section className="card b6-piutang-summary-card" aria-label={`Ringkasan ${name}`}>
      <h3>{name}</h3>
      <div className="b6-piutang-summary-pair">
        <div>
          <span>Awal</span>
          <Nilai value={awal} />
        </div>
        <div>
          <span>Akhir</span>
          <Nilai value={akhir} />
        </div>
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
        <input type="hidden" name="balance" value={query.balance} />
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
        {([
          ["all", "Semua"],
          ["nonzero", "Bersaldo"],
          ["zero", "Saldo nol"],
        ] as const).map(([value, label]) => (
          <a
            key={value}
            href={queryHref(query, { balance: value, page: 1 })}
            className={`seg-btn${query.balance === value ? " active" : ""}`}
            aria-current={query.balance === value ? "page" : undefined}
          >
            {label}
          </a>
        ))}
      </nav>

      <form method="get" className="b6-piutang-sort">
        {query.search && <input type="hidden" name="q" value={query.search} />}
        <input type="hidden" name="balance" value={query.balance} />
        <label htmlFor="b6-piutang-sort">Urutkan</label>
        <select id="b6-piutang-sort" name="sort" defaultValue={query.sort}>
          <option value="default">Bersaldo dulu, nama A–Z</option>
          <option value="name">Nama A–Z</option>
          <option value="code">Kode A–Z</option>
        </select>
        <button type="submit" className="btn-outline">
          Terapkan
        </button>
      </form>
    </div>
  );
}

function CustomerLedger({ props }: { props: Extract<PiutangPelangganViewProps, { state: "ready" }> }) {
  const columns = props.hasOnlineCustomer ? "has-online" : "without-online";
  return (
    <section className="card b6-piutang-list" aria-labelledby="b6-piutang-list-title">
      <div className="b6-piutang-list-meta">
        <div>
          <h2 id="b6-piutang-list-title">Pelanggan</h2>
          <p>
            {props.query.totalRows.toLocaleString("id-ID")} pelanggan · {props.query.pageSize} per halaman
          </p>
        </div>
        <span>
          Halaman {props.query.page} dari {Math.max(props.query.totalPages, 1)}
        </span>
      </div>

      {props.rows.length === 0 ? (
        <div className="empty-inline b6-piutang-empty">Tidak ada pelanggan yang cocok dengan pencarian dan filter ini.</div>
      ) : (
        <div className={`b6-piutang-ledger ${columns}`} role="table" aria-label="Saldo per pelanggan">
          <div className={`b6-piutang-ledger-head ${columns}`} role="row">
            <div className="b6-piutang-customer-head" role="columnheader">
              Pelanggan
            </div>
            <HeaderBucket name="Piutang Lokal" />
            {props.hasOnlineCustomer && <HeaderBucket name="Piutang Online" />}
            <HeaderBucket name="Hutang Lokal" />
          </div>
          <div role="rowgroup">
            {props.rows.map((row) => {
              const zero = semuaNol(row.balances);
              return (
                <div className={`b6-piutang-ledger-row ${columns}${zero ? " is-zero" : ""}`} role="row" key={row.customerCode}>
                  <div className="b6-piutang-customer" role="rowheader">
                    <a href={`${props.detailBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(row.customerCode.trim())}`}>
                      {row.customerName || "Nama belum tersedia"}
                    </a>
                    <span className="mono">{row.customerCode}</span>
                    {zero && <span className="b6-piutang-zero-badge">Saldo nol pada kedua batas</span>}
                  </div>
                  <BucketPair
                    name="Piutang Lokal"
                    awal={row.balances.piutangLokalAwal}
                    akhir={row.balances.piutangLokalAkhir}
                  />
                  {props.hasOnlineCustomer && (
                    <BucketPair
                      name="Piutang Online"
                      awal={row.balances.piutangOnlineAwal}
                      akhir={row.balances.piutangOnlineAkhir}
                    />
                  )}
                  <BucketPair
                    name="Hutang Lokal"
                    awal={row.balances.hutangLokalAwal}
                    akhir={row.balances.hutangLokalAkhir}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function Pagination({ query }: { query: PiutangQueryState }) {
  if (query.totalPages <= 1) return null;
  return (
    <nav className="b6-piutang-pagination no-print" aria-label="Halaman pelanggan">
      {query.page > 1 ? (
        <a className="btn-outline" rel="prev" href={queryHref(query, { page: query.page - 1 })}>
          ← Sebelumnya
        </a>
      ) : (
        <span />
      )}
      <span>
        Halaman {query.page} dari {query.totalPages}
      </span>
      {query.page < query.totalPages ? (
        <a className="btn-outline" rel="next" href={queryHref(query, { page: query.page + 1 })}>
          Berikutnya →
        </a>
      ) : (
        <span />
      )}
    </nav>
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

          <aside className="banner info b6-piutang-rule" aria-label="Aturan membaca bucket">
            <span className="dot info" aria-hidden="true" />
            <strong>Tiga bucket berbeda; jangan dijumlahkan atau dinetokan.</strong>
          </aside>

          <section className={`b6-piutang-summaries${props.hasOnlineCustomer ? " has-online" : ""}`} aria-label="Ringkasan per bucket">
            <RingkasanBucket
              name="Piutang Lokal"
              awal={props.totals.piutangLokalAwal}
              akhir={props.totals.piutangLokalAkhir}
            />
            {props.hasOnlineCustomer && (
              <RingkasanBucket
                name="Piutang Online"
                awal={props.totals.piutangOnlineAwal}
                akhir={props.totals.piutangOnlineAkhir}
              />
            )}
            <RingkasanBucket
              name="Hutang Lokal"
              awal={props.totals.hutangLokalAwal}
              akhir={props.totals.hutangLokalAkhir}
            />
          </section>

          <div className="b6-piutang-provenance">
            <span>Formula {props.provenance.formulaVersion}</span>
            <span>Dihitung {props.provenance.computedAtLabel}</span>
            <span>{props.provenance.sourceCutLabel}</span>
          </div>

          <Controls props={props} />
          <CustomerLedger props={props} />
          <Pagination query={props.query} />
        </>
      )}
    </div>
  );
}
