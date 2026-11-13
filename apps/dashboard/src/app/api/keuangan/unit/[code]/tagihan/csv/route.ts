import { notFound } from "next/navigation";
import { ptLabelForUnits } from "@/lib/config";
import { buildReportFilename } from "@/lib/export/filename";
import { belumDitagihkanCsv, tagihanCsv, type TagihanCsvKepala } from "@/lib/export/tagihan";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { todayWib } from "@/lib/periods";
import { formatWib } from "@/lib/piutang-route";
import { getDataScope } from "@/lib/scope";
import {
  TAGIHAN_BELUM_TERSEDIA,
  getBelumDitagihkan,
  getTagihanEkspor,
} from "@/lib/tagihan-queries";
import {
  isTampilanFaktur,
  tagihanKesegaranLabel,
  tagihanTampilanLabel,
  validTagihanExportInput,
} from "@/lib/tagihan-route";

export const dynamic = "force-dynamic";

/**
 * Ekspor CSV saringan aktif layar Tagihan pelanggan (rencana 2026-11-13 U7).
 * Saringan faktur mengekspor baris faktur; "Belum ditagihkan" mengekspor
 * daftar dokumennya. Tanpa halaman: seluruh baris saringan itu.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const hariIni = todayWib();
  // Ekspor MENOLAK masukan tak sah; ia tidak menormalkannya diam-diam seperti halaman.
  const view = validTagihanExportInput(new URL(request.url).searchParams, hariIni);
  if (!view) return new Response("Saringan, halaman, atau periode tidak valid", { status: 400 });

  // This export is an independent authenticated surface; page access is irrelevant.
  const scope = await getDataScope();
  const unit = scope.requireUnit(code);
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const belumTersedia = () =>
    Response.json({ status: "belum tersedia", reason: TAGIHAN_BELUM_TERSEDIA }, { status: 409 });
  const kepala = (selesaiAt: string, terpotong: boolean): TagihanCsvKepala => ({
    unit: { code: unit.code, name: unit.name },
    ptLabel: ptLabelForUnits([unit.code]),
    tampilanLabel: tagihanTampilanLabel(view.tampilan),
    cari: view.search,
    hariIni,
    kesegaranLabel: tagihanKesegaranLabel(selesaiAt),
    generatedLabel: formatWib(new Date().toISOString()),
    generatedBy: scope.email ?? "(identitas tak diketahui)",
    terpotong,
  });

  let csv: string;
  if (isTampilanFaktur(view.tampilan)) {
    const data = await getTagihanEkspor(unit.unit_id, {
      filter: view.tampilan,
      cari: view.search,
      periodeLunas: view.periode,
      hariIni,
    });
    if (!data.tersedia) return belumTersedia();
    csv = tagihanCsv({
      ...kepala(data.kesiapan.selesaiAt, data.terpotong),
      periodeLunas: data.periodeLunas,
      baris: data.baris,
    });
  } else {
    // Kelompok menentukan pelanggan mana yang lolos pencarian — aturan yang sama
    // dengan layar; dokumennya lalu disaring ke pelanggan-pelanggan itu. Keduanya
    // keluar dari SATU kueri: buku piutang dipindai sekali per ekspor.
    const data = await getBelumDitagihkan(unit.unit_id, { cari: view.search, hariIni, dokumen: "semua" });
    if (!data.tersedia) return belumTersedia();
    const semua = data.dokumen ?? { dokumen: [], terpotong: false };
    const pelanggan = new Set(data.kelompok.map((k) => k.customerCode));
    csv = belumDitagihkanCsv({
      ...kepala(data.kesiapan.selesaiAt, data.terpotong || semua.terpotong),
      dokumen: semua.dokumen.filter((d) => pelanggan.has(d.customerCode)),
    });
  }

  const filename = buildReportFilename({
    reportName: `Tagihan-Pelanggan-${tagihanTampilanLabel(view.tampilan)}`,
    unitCode: unit.code,
    period: view.tampilan === "lunas" ? `${view.periode.from}-sd-${view.periode.to}` : hariIni,
    generated: hariIni,
  }).replace(/\.pdf$/, ".csv");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
