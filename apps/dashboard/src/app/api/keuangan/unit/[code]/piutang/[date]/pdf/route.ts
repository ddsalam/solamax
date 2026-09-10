import { notFound } from "next/navigation";
import { ptLabelForUnits } from "@/lib/config";
import { buildReportFilename } from "@/lib/export/filename";
import { buildPiutangDoc } from "@/lib/export/piutang";
import { renderPdfBuffer } from "@/lib/export/server-pdf";
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

  // Independent guard: re-resolve URL code through the signed-in user's unit scope.
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();
  const snapshot = await getSaldoSnapshot(unit.unit_id, date);
  const view = buildPiutangExportView(snapshot, input);
  if (view.status !== "ready") {
    return Response.json({ status: "belum siap", reason: view.reason }, { status: 409 });
  }

  const generated = new Date().toISOString();
  const doc = buildPiutangDoc({
    kop: {
      ptLabel: ptLabelForUnits([unit.code]),
      judul: "Daftar Saldo Hutang Piutang per Pelanggan",
      subjudul: `SPBU ${unit.code} · ${unit.name} · Tanggal ${date}`,
      generatedLabel: formatWib(generated).replace(/ WIB$/, ""),
      dicetakOleh: scope.email ?? "(identitas tak diketahui)",
    },
    view,
  });
  const pdf = await renderPdfBuffer(doc);
  const filename = buildReportFilename({
    reportName: "Daftar-Saldo-Hutang-Piutang",
    unitCode: unit.code,
    period: date,
    generated: todayWib(),
  });
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
