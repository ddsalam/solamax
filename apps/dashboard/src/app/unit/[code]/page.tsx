import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCashCategories,
  getComplianceMatrix,
  getDailySales,
  getLastInputs,
  getProductSales,
  getSelisih,
  getTankCount,
  getUnitByCode,
  getUnits,
} from "@/lib/queries";
import { fmtL, fmtRp } from "@/lib/compliance";
import { ComplianceMatrix } from "@/components/ComplianceMatrix";
import { LastInputCards } from "@/components/LastInputCards";
import { SelisihTable } from "@/components/SelisihTable";
import { SalesChart } from "@/components/SalesChart";

export const dynamic = "force-dynamic";

const RANGE_DAYS = 30; // default rentang masuk akal

export default async function UnitPage({
  params,
}: {
  params: { code: string };
}) {
  const unit = await getUnitByCode(params.code);
  if (!unit) notFound();

  const [units, matrix, tanks, last, selisih, daily, products, cashCats] =
    await Promise.all([
      getUnits(),
      getComplianceMatrix(unit.unit_id, RANGE_DAYS),
      getTankCount(unit.unit_id),
      getLastInputs(unit.unit_id),
      getSelisih(unit.unit_id, RANGE_DAYS),
      getDailySales(unit.unit_id, RANGE_DAYS),
      getProductSales(unit.unit_id, RANGE_DAYS),
      getCashCategories(unit.unit_id),
    ]);

  const totVol = daily.reduce((s, d) => s + d.vol, 0);
  const totOmzet = daily.reduce((s, d) => s + d.omzet, 0);

  return (
    <>
      <div style={{ marginTop: 12, fontSize: 13 }}>
        <Link href="/">← Ringkasan grup</Link>
        {units.length > 1 && (
          <span style={{ marginLeft: 12, color: "var(--muted)" }}>
            Unit lain:{" "}
            {units
              .filter((u) => u.code !== unit.code)
              .map((u) => (
                <Link key={u.code} href={`/unit/${u.code}`} style={{ marginRight: 8 }}>
                  {u.name}
                </Link>
              ))}
          </span>
        )}
      </div>

      <div className="panel">
        <h2>
          🎯 Matriks Kepatuhan Input — {unit.name} (SPBU {unit.code})
        </h2>
        <p className="desc">
          {RANGE_DAYS} hari terakhir, per modul per hari bisnis. Yang KOSONG (🔴)
          adalah temuan pengawasan — bukan sekadar belum sinkron: data ditarik
          langsung dari EasyMax tiap beberapa menit.
        </p>
        <ComplianceMatrix days={matrix} tankCount={tanks} />
      </div>

      <div className="panel">
        <h2>Input Terakhir per Modul</h2>
        <p className="desc">
          Merah = melewati ambang wajar modulnya (penjualan/opname ±1 hari, kas 7
          hari). Kas yang berhenti bertahun-tahun akan menyala di sini.
        </p>
        <LastInputCards last={last} />
      </div>

      <div className="panel">
        <h2>⚠️ Selisih Stok & Kiriman (indikator losses)</h2>
        <p className="desc">
          NVOLSELISIH terbesar {RANGE_DAYS} hari terakhir dari opname (fisik vs
          buku) dan penerimaan BBM (DO vs real). Merah = abnormal (&gt;100 L atau
          &gt;0,5% basis). Baris dicoret = dibatalkan (SBATAL).
        </p>
        <SelisihTable rows={selisih} />
      </div>

      <div className="panel">
        <h2>Omzet & Volume — {RANGE_DAYS} hari</h2>
        <div className="kpis">
          <div className="kpi">
            <div className="label">Total volume</div>
            <div className="value">{fmtL(totVol)}</div>
          </div>
          <div className="kpi">
            <div className="label">Total omzet</div>
            <div className="value">{fmtRp(totOmzet)}</div>
          </div>
        </div>
        <SalesChart data={daily} />
        {products.length > 0 && (
          <table className="list" style={{ marginTop: 14, maxWidth: 560 }}>
            <thead>
              <tr>
                <th>Produk</th>
                <th className="num">Volume</th>
                <th className="num">Omzet</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.ckdbbm}>
                  <td>{p.nama}</td>
                  <td className="num">{fmtL(p.vol)}</td>
                  <td className="num">{fmtRp(p.omzet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>Kas / Pengeluaran per Kategori</h2>
        {cashCats.length === 0 ? (
          <div className="empty">Belum ada data kas.</div>
        ) : (
          <>
            <p className="desc">
              Join chart-of-accounts (tm_perk). Modul kas unit ini dorman — angka
              di bawah adalah histori terakhir tercatat; lihat flag STALE di atas.
            </p>
            <table className="list" style={{ maxWidth: 640 }}>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Kategori</th>
                  <th className="num">Nota</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {cashCats.map((c) => (
                  <tr key={c.ckdperk}>
                    <td>{c.ckdperk}</td>
                    <td>{c.nama}</td>
                    <td className="num">{c.n}</td>
                    <td className="num">{fmtRp(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}
