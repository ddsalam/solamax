import { notFound } from "next/navigation";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { PiutangPelangganView } from "@/components/keuangan/PiutangPelangganView";
import { unitDotted } from "@/lib/config";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { buildPiutangView } from "@/lib/piutang-model";
import {
  balanceSetFromRow,
  balanceSetFromTotals,
  formatWib,
  pendingBanner,
  piutangExportHref,
  piutangViewInput,
  readinessProps,
} from "@/lib/piutang-route";
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
            page: view.page,
            pageSize: 50,
            totalRows: view.resultCount,
            totalPages: view.totalPages,
          }}
          provenance={{
            formulaVersion: view.metadata.formulaVersion,
            computedAtLabel: formatWib(view.metadata.computedAt),
            sourceCutLabel: `Siklus sumber ${view.metadata.sourceCycleId} selesai ${formatWib(view.metadata.sourceCompletedAt)}`,
          }}
          totals={balanceSetFromTotals(view)}
          rows={view.rows.map((row) => ({
            customerCode: row.customerCode,
            customerName: row.customerName ?? "Nama belum tersedia",
            balances: balanceSetFromRow(row),
          }))}
          csvHref={piutangExportHref("csv", unit.code, date, view)}
          pdfHref={piutangExportHref("pdf", unit.code, date, view)}
          pendingBanner={pendingBanner(snapshot as Extract<typeof snapshot, { status: "ready" }>)}
        />
      )}
    </>
  );
}
