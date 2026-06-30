import { notFound } from "next/navigation";
import { UsulanForm, type UsulanRowInput } from "@/components/usulan/UsulanForm";
import { UsulanToolbar } from "@/components/usulan/Toolbar";
import { DO_PRODUCTS, resolveDoProduct, unitDotted } from "@/lib/config";
import { enduranceDays, enduranceLevel } from "@/lib/derive";
import { dateLong } from "@/lib/format";
import { addDays } from "@/lib/periods";
import {
  getAvgDailySales,
  getClosingStock,
  getDoHarian,
  getUsulanSo,
  type UsulanStatus,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

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

  const [closingPrev, doDay, avg7, existing] = await Promise.all([
    // "Sisa Stock awal hari D" = penutup D−1 (carry-forward, terbukti probe).
    getClosingStock(unit.unit_id, prevDay),
    // "Sisa DO awal hari D" = do_awal(D) ≡ sisa(D−1) (logika getDoHarian).
    getDoHarian(unit.unit_id, date),
    // Ketahanan = stok awal ÷ rata-rata jual 7 hari (s/d D−1).
    getAvgDailySales(unit.unit_id, addDays(date, -7), prevDay),
    getUsulanSo(unit.unit_id, date),
  ]);

  // Agregasi per slot produk DO (6 kanonik). ckdbbm→key dari nama penutup stok.
  const stockByKey = new Map<string, number>();
  const ckdbbmToKey = new Map<string, string>();
  for (const r of closingPrev) {
    const key = resolveDoProduct(r.nama)?.key;
    if (!key) continue;
    ckdbbmToKey.set(r.ckdbbm, key);
    if (r.stock !== null) stockByKey.set(key, (stockByKey.get(key) ?? 0) + r.stock);
  }
  const avgByKey = new Map<string, number>();
  for (const a of avg7) {
    const key = ckdbbmToKey.get(a.ckdbbm) ?? resolveDoProduct(a.ckdbbm)?.key;
    if (!key) continue;
    avgByKey.set(key, (avgByKey.get(key) ?? 0) + a.avg_vol);
  }
  const doAwalByKey = new Map<string, number>();
  for (const r of doDay) {
    const key = resolveDoProduct(r.nama)?.key;
    if (key) doAwalByKey.set(key, (doAwalByKey.get(key) ?? 0) + r.do_awal);
  }
  const savedByKey = new Map(existing.map((e) => [e.productKey, e]));
  const status: UsulanStatus = existing[0]?.status ?? "draft";

  const rows: UsulanRowInput[] = DO_PRODUCTS.map((p) => {
    const sisaStock = stockByKey.has(p.key) ? stockByKey.get(p.key)! : null;
    const days = enduranceDays(sisaStock, avgByKey.get(p.key) ?? 0);
    const s = savedByKey.get(p.key);
    return {
      key: p.key,
      label: p.label,
      sisaStock,
      ketahanan: days,
      ketahananLevel: enduranceLevel(days),
      sisaDo: doAwalByKey.get(p.key) ?? 0,
      penerimaanHari: s?.penerimaanHari ?? 0,
      permintaanBesok: s?.permintaanBesok ?? 0,
      usulanPenebusan: s?.usulanPenebusan ?? 0,
    };
  });

  return (
    <div className="lap-page">
      <UsulanToolbar code={unit.code} date={date} mode="form" />

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
