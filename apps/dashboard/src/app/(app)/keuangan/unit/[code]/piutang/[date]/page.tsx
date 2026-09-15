import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { PiutangPelangganView } from "@/components/keuangan/PiutangPelangganView";
import { unitDotted } from "@/lib/config";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { buildPiutangView } from "@/lib/piutang-model";
import {
  formatWib,
  pendingBanner,
  piutangExportHref,
  piutangViewInput,
  readinessProps,
  TIDAK_BEKU,
} from "@/lib/piutang-route";
import { getCachedSaldoFreshness } from "@/lib/saldo-cache";
import { getSaldoSnapshot } from "@/lib/saldo-snapshot";
import { getDataScope } from "@/lib/scope";
import { DATE_RE } from "@/lib/selection-keys";
import { todayWib } from "@/lib/periods";

export const dynamic = "force-dynamic";

export default async function PiutangPelangganPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code, date }, rawQuery] = await Promise.all([params, searchParams]);
  if (!DATE_RE.test(date)) notFound();

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  // Strict B6 read path: no legacy ledger fallback and no per-customer query.
  const snapshot = await getSaldoSnapshot(unit.unit_id, date);
  // Probe kesegaran ber-cache (300 dtk), BUKAN per render: 2,6 detik/unit.
  // Ia menutup lubang 13-09-2026 — koreksi mundur yang tak terlihat ±18 jam.
  const freshness = snapshot.status === "ready"
    ? await getCachedSaldoFreshness(
        unit.unit_id, date, snapshot.metadata.generationId, snapshot.metadata.totals)
    : undefined;
  const view = buildPiutangView(snapshot, piutangViewInput(rawQuery));
  const detailBaseUrl = `/keuangan/unit/${encodeURIComponent(unit.code)}/piutang/${date}/pelanggan`;

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={unit.code}
        segment="keuangan-piutang"
        date={date}
        today={todayWib()}
        maxDate={todayWib()}
      />
      {view.status === "not_ready" ? (
        <PiutangPelangganView
          state="not_ready"
          unit={{ code: unit.code, name: unit.name }}
          date={date}
          detailBaseUrl={detailBaseUrl}
          readiness={readinessProps(snapshot as Extract<typeof snapshot, { status: "not_ready" }>)}
        />
      ) : (
        <PiutangPelangganView
          state="ready"
          unit={{ code: unit.code, name: unit.name }}
          date={date}
          detailBaseUrl={detailBaseUrl}
          hasOnlineCustomer={view.hasOnlineCustomer}
          query={{
            search: view.search,
            filter: view.filter,
            sort: view.sort,
            totalRows: view.resultCount,
            occurrenceCount: view.occurrenceCount,
          }}
          provenance={{
            formulaVersion: view.metadata.formulaVersion,
            computedAtLabel: formatWib(view.metadata.computedAt),
            sourceCutLabel: `Siklus sumber ${view.metadata.sourceCycleId} selesai ${formatWib(view.metadata.sourceCompletedAt)}. ${TIDAK_BEKU}`,
          }}
          historicalNote={view.historicalNote}
          summary={view.metadata}
          sections={view.sections}
          zeroSectionOpen={view.zeroSectionOpen}
          csvHref={piutangExportHref("csv", unit.code, date, view)}
          pdfHref={piutangExportHref("pdf", unit.code, date, view)}
          pendingBanner={pendingBanner(snapshot as Extract<typeof snapshot, { status: "ready" }>, freshness)}
        />
      )}
    </>
  );
}
