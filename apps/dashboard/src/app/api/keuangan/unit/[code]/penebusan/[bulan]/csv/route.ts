import { notFound } from "next/navigation";
import { ptLabelForUnits, unitLabel } from "@/lib/config";
import { penebusanCsv } from "@/lib/export/penebusan";
import { buildReportFilename } from "@/lib/export/filename";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { bulanSah, unitSatuPt } from "@/lib/penebusan-model";
import { getPenebusanBulan } from "@/lib/penebusan-queries";
import { formatWib } from "@/lib/piutang-route";
import { getDataScope } from "@/lib/scope";
import { todayWib } from "@/lib/periods";

export const dynamic = "force-dynamic";

/**
 * Ekspor CSV rekap pajak penebusan per bulan (rencana 2026-10-29 U7; R13).
 * `?cakupan=pt` = gabungan unit satu PT — HANYA bila pengguna memegang SEMUA
 * unit aktif tenant itu (`unitSatuPt`); selain itu 404, tak pernah rekap PT
 * yang diam-diam tak lengkap. Permukaan berotentikasi sendiri: gerbang halaman
 * tidak dianggap berlaku di sini.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; bulan: string }> },
) {
  const { code, bulan } = await params;
  if (!bulanSah(bulan)) return new Response("Bulan tidak valid — format YYYY-MM", { status: 400 });
  const cakupan = new URL(request.url).searchParams.get("cakupan") ?? "unit";
  if (cakupan !== "unit" && cakupan !== "pt") return new Response("Cakupan tidak valid", { status: 400 });

  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const units = cakupan === "pt" ? unitSatuPt(unit.code, scope.tenantPerUnit, scope.units) : [unit];
  if (units === null) notFound();

  const rows = await getPenebusanBulan(
    units.map((u) => u.unit_id),
    bulan,
  );
  const kode = units.map((u) => u.code);
  const csv = penebusanCsv({
    judulCakupan: cakupan === "pt" ? `Seluruh unit PT (${kode.map((c) => unitLabel(c)).join(", ")})` : unitLabel(unit.code, unit.name),
    ptLabel: ptLabelForUnits(kode),
    bulan,
    rows,
    generatedLabel: formatWib(new Date().toISOString()),
    generatedBy: scope.email ?? "(identitas tak diketahui)",
  });
  const filename = buildReportFilename({
    reportName: "Rekap-Pajak-Penebusan",
    ...(cakupan === "pt" ? { scope: ptLabelForUnits(kode) } : { unitCode: unit.code }),
    period: bulan,
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
