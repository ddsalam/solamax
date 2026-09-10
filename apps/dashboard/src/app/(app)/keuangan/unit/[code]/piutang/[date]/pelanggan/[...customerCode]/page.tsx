import Link from "next/link";
import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { PiutangPelangganView } from "@/components/keuangan/PiutangPelangganView";
import { unitDotted } from "@/lib/config";
import { rp } from "@/lib/format";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { balanceSetFromRow, formatWib, pendingBanner, readinessProps } from "@/lib/piutang-route";
import { getSaldoSnapshot } from "@/lib/saldo-snapshot";
import { getDataScope } from "@/lib/scope";
import { DATE_RE } from "@/lib/selection-keys";
import { todayWib } from "@/lib/periods";

export const dynamic = "force-dynamic";

const bucket = (name: string, awal: number, akhir: number) => (
  <section className="card b6-piutang-summary-card" aria-label={name}>
    <h3>{name}</h3>
    <div className="b6-piutang-summary-pair">
      <div><span>Awal · dtgl &lt; D · s.d. D−1</span><strong className="num">{rp(awal)}</strong></div>
      <div><span>Akhir · dtgl ≤ D · s.d. D</span><strong className="num">{rp(akhir)}</strong></div>
    </div>
  </section>
);

export default async function PiutangPelangganDetailPage({
  params,
}: {
  params: Promise<{ code: string; date: string; customerCode: string[] }>;
}) {
  const { code, date, customerCode } = await params;
  if (!DATE_RE.test(date)) notFound();

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  // One exact snapshot read; the customer is selected from that immutable rowset.
  const snapshot = await getSaldoSnapshot(unit.unit_id, date);
  const listUrl = `/keuangan/unit/${encodeURIComponent(unit.code)}/piutang/${date}`;
  if (snapshot.status === "not_ready") {
    return (
      <>
        <UnitDateFilters units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))} code={unit.code} segment="keuangan-piutang" date={date} today={todayWib()} maxDate={todayWib()} />
        <PiutangPelangganView state="not_ready" unit={{ code: unit.code, name: unit.name }} date={date} detailBaseUrl={`${listUrl}/pelanggan`} readiness={readinessProps(snapshot)} />
      </>
    );
  }

  // Preserve legal EasyMax slashes whether Next supplies one encoded segment
  // (`NOL%2F02`) or decoded catch-all segments (`NOL`, `02`).
  const joined = customerCode.join("/").trim();
  let row = snapshot.rows.find((candidate) => candidate.customerCode.trim() === joined);
  try {
    const decoded = decodeURIComponent(joined).trim();
    row ??= snapshot.rows.find((candidate) => candidate.customerCode.trim() === decoded);
  } catch {
    // A literal percent is valid after Next has decoded the route. The raw
    // joined form above remains the authoritative first match.
  }
  if (!row) notFound();
  const b = balanceSetFromRow(row);
  const banner = pendingBanner(snapshot);

  return (
    <>
      <UnitDateFilters units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))} code={unit.code} segment="keuangan-piutang" date={date} today={todayWib()} maxDate={todayWib()} />
      <div className="b6-piutang-page">
        <header className="b6-piutang-heading">
          <div>
            <div className="text-eyebrow t-tertiary">Keuangan · Saldo pelanggan</div>
            <h1 className="text-h3 t-brand">{row.customerName?.trim() || "Nama belum tersedia"}</h1>
            <p>{row.customerCode.trim()} · SPBU {unit.code} · {unit.name} · {date}</p>
          </div>
          <Link className="btn-outline no-print" href={listUrl}>← Kembali ke daftar</Link>
        </header>
        {banner && <div className={`banner ${banner.tone}`} role="status"><span className={`dot ${banner.tone}`} aria-hidden="true" /><div><strong>{banner.title}</strong><p>{banner.body}</p></div></div>}
        <aside className="banner info b6-piutang-rule"><span className="dot info" aria-hidden="true" /><strong>Tiga bucket berbeda; jangan dijumlahkan atau dinetokan.</strong></aside>
        <div className={`b6-piutang-summaries${snapshot.hasOnlineCustomer ? " has-online" : ""}`}>
          {bucket("Piutang Lokal", b.piutangLokalAwal, b.piutangLokalAkhir)}
          {snapshot.hasOnlineCustomer && bucket("Piutang Online", b.piutangOnlineAwal, b.piutangOnlineAkhir)}
          {bucket("Hutang Lokal", b.hutangLokalAwal, b.hutangLokalAkhir)}
        </div>
        <p className="b6-piutang-provenance">Formula {snapshot.metadata.formulaVersion} · dihitung {formatWib(snapshot.metadata.computedAt)} · siklus sumber {snapshot.metadata.sourceCycleId} selesai {formatWib(snapshot.metadata.sourceCompletedAt)}</p>
        <section className="card b6-piutang-activity" aria-labelledby="b6-activity-title">
          <h2 id="b6-activity-title">Aktivitas pelanggan</h2>
          <p>Ruang ini disiapkan untuk Tagihan, Pembayaran, Aging, dan Kebijakan kredit pada fase berikutnya. Belum ada tab atau angka aktivitas pada Fase 1.</p>
        </section>
      </div>
    </>
  );
}
