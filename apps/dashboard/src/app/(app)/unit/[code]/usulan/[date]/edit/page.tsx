import { notFound } from "next/navigation";
import { UsulanExport } from "@/components/usulan/UsulanExport";
import { UsulanForm } from "@/components/usulan/UsulanForm";
import { unitDotted } from "@/lib/config";
import { dateLong, dateShort, timeWib } from "@/lib/format";
import { addDays, todayWib } from "@/lib/periods";
import { getAvgDailySales, getDailyGlByProduct, getDoHarian, getUsulanSo } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import { buildUsulanModel } from "@/lib/usulan-model";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function UsulanEditPage({
  params,
}: {
  params: { code: string; date: string };
}) {
  if (!DATE_RE.test(params.date)) notFound();
  const scope = await getDataScope();
  const unit = scope.requireUnit(params.code); // notFound bila di luar scope/tak ada
  const date = params.date;
  const prevDay = addDays(date, -1);

  const [glPrev, doDay, avg7, existing] = await Promise.all([
    // "Sisa Stock awal hari D" = Stock Fisik penutup D−1 — SUMBER TUNGGAL dgn
    // Laporan Harian/RESUME (getDailyGlByProduct.fisik). Rentang 1-hari (murah).
    getDailyGlByProduct(unit.unit_id, prevDay, prevDay),
    // "Sisa DO awal hari D" = do_awal(D) ≡ sisa(D−1) (logika getDoHarian).
    getDoHarian(unit.unit_id, date),
    // Ketahanan = stok awal ÷ rata-rata jual 7 hari (s/d D−1).
    getAvgDailySales(unit.unit_id, addDays(date, -7), prevDay),
    getUsulanSo(unit.unit_id, date),
  ]);

  // SUMBER TUNGGAL: model dipakai render layar (UsulanForm) DAN ekspor PDF →
  // nilai identik "ke KL". Data sudah ber-scope (ScopedUnitId).
  const model = buildUsulanModel({ glPrev, doDay, avg7, existing });
  const { rows, status } = model;

  const generatedDate = todayWib();
  const exportMeta = {
    unitDotted: unitDotted(unit.code),
    unitName: unit.name,
    dateLong: dateLong(date),
    prevDateLong: dateLong(prevDay),
    statusLabel: status === "diajukan" ? "Diajukan ke Keuangan" : "Draft",
    generatedLabel: `${dateShort(generatedDate)} · ${timeWib(new Date().toISOString())}`,
  };

  return (
    <div className="lap-page">
      <UsulanExport
        code={unit.code}
        businessDate={date}
        generatedDate={generatedDate}
        model={model}
        meta={exportMeta}
      />

      <div className="board-head mt6">
        <div>
          <div className="text-eyebrow t-tertiary">
            Usulan Penebusan SO · SPBU {unitDotted(unit.code)}
          </div>
          <h1 className="text-h3 t-brand mt2">{unit.name}</h1>
          <div className="fs16 t-secondary mt2">
            Tanggal usulan {dateLong(date)} · Sisa Stock &amp; Sisa DO = awal hari (penutup{" "}
            {dateLong(prevDay)})
          </div>
        </div>
      </div>

      <div className="section-h mt8">
        <div className="text-h5 t-brand">Sisa &amp; Ketahanan Stock &amp; DO</div>
        <span className="fs16 t-tertiary">
          awal hari (carry-forward D−1) · isi Penerimaan / Permintaan / Usulan lalu Simpan / Ajukan
        </span>
      </div>

      <UsulanForm code={unit.code} date={date} rows={rows} status={status} />

      <div className="page-foot mt8">
        <span>
          Ditujukan ke Keuangan · Sisa Stock awal = penutup stok {dateLong(prevDay)}; Sisa DO awal =
          saldo DO per-SO awal hari.
        </span>
        <span>Disusun otomatis oleh SolaMax · input pengawas tersimpan & dapat diajukan</span>
      </div>
    </div>
  );
}
