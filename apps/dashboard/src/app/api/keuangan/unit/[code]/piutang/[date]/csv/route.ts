import { notFound } from "next/navigation";
import { ptLabelForUnits } from "@/lib/config";
import { piutangCsv } from "@/lib/export/piutang";
import { buildReportFilename } from "@/lib/export/filename";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { buildPiutangExportView } from "@/lib/piutang-model";
import { formatWib, validPiutangExportInput } from "@/lib/piutang-route";
import { getSaldoSnapshot } from "@/lib/saldo-snapshot";
import { getDataScope } from "@/lib/scope";
import { DATE_RE } from "@/lib/selection-keys";
import { todayWib } from "@/lib/periods";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; date: string }> },
) {
  const { code, date } = await params;
  if (!DATE_RE.test(date)) return new Response("Tanggal tidak valid", { status: 400 });
  const input = validPiutangExportInput(new URL(request.url).searchParams);
  if (!input) return new Response("Filter atau urutan tidak valid", { status: 400 });

  // This export is an independent authenticated surface; page access is irrelevant.
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();
  const snapshot = await getSaldoSnapshot(unit.unit_id, date);
  const view = buildPiutangExportView(snapshot, input);
  if (view.status !== "ready") {
    return Response.json({ status: "belum siap", reason: view.reason }, { status: 409 });
  }

  const generated = new Date().toISOString();
  const csv = piutangCsv({
    unit: { code: unit.code, name: unit.name },
    ptLabel: ptLabelForUnits([unit.code]),
    view,
    generatedLabel: formatWib(generated),
    generatedBy: scope.email ?? "(identitas tak diketahui)",
  });
  const filename = buildReportFilename({
    reportName: "Daftar-Saldo-Hutang-Piutang",
    unitCode: unit.code,
    period: date,
    generated: todayWib(),
  }).replace(/\.pdf$/, ".csv");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
