import { notFound } from "next/navigation";
import { EmptyPanel } from "@/components/EmptyPanel";
import { LaporanExport } from "@/components/laporan/LaporanExport";
import { unitDotted } from "@/lib/config";
import { DOMAIN, REKON_READY } from "@/lib/flags";
import {
  dateLong,
  dateShort,
  fmtL,
  idn,
  parenNeg,
  pct,
  rp,
  rpShort,
  signed,
  timeWib,
} from "@/lib/format";
import { monthInfo, monthStart, todayWib } from "@/lib/periods";
import {
  getCashForDate,
  getDailyGlByProduct,
  getCorrections,
  getDeliveryByProduct,
  getDoAnomalies,
  getDoHarian,
  getDoSuspectSO,
  DO_STALE_DAYS,
  getSalesByProduct,
  getShiftInfo,
  getSaldoPelanggan,
  getPelangganForDate,
  getEdcForDate,
  getDepositForDate,
  getManualEntries,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import { alurSelisihNote, buildLaporanModel } from "@/lib/laporan-model";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function LaporanPage({
  params,
  searchParams,
}: {
  params: { code: string; date: string };
  searchParams: { view?: string };
}) {
  if (!DATE_RE.test(params.date)) notFound();
  const scope = await getDataScope();
  const unit = scope.requireUnit(params.code); // notFound bila di luar scope/tak ada
  const date = params.date;
  const detail = searchParams.view !== "ringkas";
  const today = todayWib();
  const mi = monthInfo(date);
  const mStart = monthStart(date);

  const [
    prodDay,
    glRows,
    prodMonth,
    delivMonth,
    doDay,
    doAnomalies,
    doSuspects,
    shift,
    corrections,
    cash,
    saldo,
    recapPelanggan,
    recapEdc,
    recapDeposit,
    recapPendapatanLain,
    recapPengeluaran,
    recapSetoran,
  ] = await Promise.all([
    getSalesByProduct(unit.unit_id, date, date),
    // G/L harian metode RESUME — satu fetch bulan-berjalan; turunkan harian (filter
    // d=date) & kumulatif (Σ). Lookback D−1 ditangani di query (anchor benar).
    getDailyGlByProduct(unit.unit_id, mStart, date),
    getSalesByProduct(unit.unit_id, mStart, date),
    getDeliveryByProduct(unit.unit_id, mStart, date),
    getDoHarian(unit.unit_id, date),
    getDoAnomalies(unit.unit_id, date),
    getDoSuspectSO(unit.unit_id, date),
    getShiftInfo(unit.unit_id, date),
    getCorrections(unit.unit_id, date),
    getCashForDate(unit.unit_id, date),
    getSaldoPelanggan(unit.unit_id, date),
    getPelangganForDate(unit.unit_id, date),
    getEdcForDate(unit.unit_id, date),
    getDepositForDate(unit.unit_id, date),
    getManualEntries(unit.unit_id, date, "pendapatan_lain"),
    getManualEntries(unit.unit_id, date, "pengeluaran"),
    getManualEntries(unit.unit_id, date, "setoran_tunai"),
  ]);

  // SUMBER TUNGGAL: model dipakai render layar (di bawah) DAN ekspor PDF → angka
  // identik "ke rupiah". Data sudah ber-scope (ScopedUnitId).
  const m = buildLaporanModel(
    {
      prodDay,
      glRows,
      prodMonth,
      delivMonth,
      doDay,
      doAnomalies,
      doSuspects,
      shift,
      corrections,
      cash,
      saldo,
      recapPelanggan,
      recapEdc,
      recapDeposit,
      recapPendapatanLain,
      recapPengeluaran,
      recapSetoran,
    },
    { unitCode: unit.code, date, today, mi, detail },
  );
  // Rekonstruksi nama-nama lama agar JSX di bawah tetap identik.
  const { sales, recap, glMonthly, target, doHarian, harga, rekon, header } = m;
  const {
    rows: doRows,
    totals: doTotal,
    anomRows: doAnomRows,
    suspects: doSuspectRows,
    suspectsNonaktif,
  } = doHarian;
  const {
    totVol: totSales,
    totOmzet,
    glTotal,
    totTera,
    glPctDay,
    glProvisional,
    glGarbageCount,
    gasMix,
    oilMix,
  } = sales;
  const { glMonthTotal, glPctMonth } = glMonthly;
  const { hasRecap, hasSaldo, saldoRows, recapBoxes } = recap;
  const { isPartial, provisionalCount } = header;
  const scoreTone = `t-${header.scoreTone}`;
  const score = { text: header.scoreText, provisional: provisionalCount, fail: header.fail };
  const visibleChecks = m.checks.filter((c) => c.state !== "na");

  const generatedDate = today;
  const exportMeta = {
    unitDotted: unitDotted(unit.code),
    unitName: unit.name,
    dateLong: dateLong(date),
    monthName: dateLong(date).split(" ")[2] ?? "",
    dayOfMonth: mi.dayOfMonth,
    daysInMonth: mi.daysInMonth,
    staleDays: DO_STALE_DAYS,
    generatedLabel: `${dateShort(generatedDate)} · ${timeWib(new Date().toISOString())}`,
  };

  return (
    <div className="lap-page">
      <LaporanExport
        code={unit.code}
        businessDate={date}
        generatedDate={generatedDate}
        detail={detail}
        model={m}
        meta={exportMeta}
      />

      {/* Header */}
      <div className="board-head mt6">
        <div>
          <div className="text-eyebrow t-tertiary">
            Laporan Operasional Harian · SPBU {unitDotted(unit.code)}
          </div>
          <h1 className="text-h3 t-brand mt2">{unit.name}</h1>
          <div className="fs16 t-secondary mt2">
            Tanggal bisnis {dateLong(date)} ·{" "}
            {isPartial
              ? `${shift.shifts}/3 shift terinput · shift berjalan`
              : `${Math.min(shift.shifts, 3)}/3 shift terinput${shift.last_dtgljam ? ` · input terakhir ${timeWib(shift.last_dtgljam)} WIB` : ""}`}
          </div>
        </div>
        <div className="lap-headnums">
          <div className="right">
            <div className="fs15 t-tertiary">Alarm indikator</div>
            <div className={`text-h4 num ${scoreTone}`}>{score.text}</div>
            <div className="fs15 t-tertiary">
              {score.provisional > 0 ? `cek sesuai · ${score.provisional} sementara` : "cek sesuai"}
            </div>
          </div>
          <div className="lap-headdiv" />
          <div className="right">
            <div className="fs15 t-tertiary">Omset hari ini</div>
            <div className="text-h4 num">{rpShort(totOmzet)}</div>
          </div>
        </div>
      </div>

      {isPartial && (
        <div className="banner warning mt6">
          <span className="dot lg warning" />
          <div>
            <div className="text-caption w600 t-warning">
              Data tanggal bisnis ini belum lengkap — {shift.shifts}/3 shift penjualan terinput
            </div>
            <div className="fs16 t-secondary mt1">
              Shift 3 tutup besok pagi ±06.00 WIB. Angka di bawah adalah angka berjalan; alarm
              indikator final dihitung setelah modul lengkap.
            </div>
          </div>
        </div>
      )}

      {/* 4 · ALARM INDIKATOR */}
      <div className={`alarm-card mt8${score.fail > 1 ? " bad" : ""}`}>
        <div className="alarm-head">
          <div className="text-h5 t-brand">Alarm Indikator</div>
          <span className="fs16 t-tertiary">
            cek harian — yang dilihat pertama oleh pengawas &amp; atasan
          </span>
          <span className={`alarm-note w700 num ${scoreTone}`}>
            {score.text} sesuai{score.provisional > 0 ? ` · ${score.provisional} sementara` : ""}
          </span>
        </div>
        <div className="alarm-grid">
          {visibleChecks.map((c) => (
            <div key={c.label} className="alarm-row">
              <span className={`alarm-mark ${c.state}`}>
                {c.state === "ok" ? "✓" : c.state === "fail" ? "✗" : c.state === "provisional" ? "~" : "—"}
              </span>
              <span
                className={`text-body ${
                  c.state === "fail"
                    ? "t-danger w700"
                    : c.state === "provisional"
                      ? "t-warning w700"
                      : c.state === "na"
                        ? "t-tertiary"
                        : "t-primary"
                }`}
              >
                {c.label}
              </span>
              <span
                className={`alarm-note num ${
                  c.state === "fail" ? "t-danger" : c.state === "provisional" ? "t-warning" : "t-tertiary"
                }`}
              >
                {c.note}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2 · OMSET, GAIN(LOSSES), TERA */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">
            Omset Penjualan, Gain (Losses) &amp; Tera Harian
          </div>
          <span className="fs16 t-tertiary">per produk · dari totalisator nozzle per shift</span>
          {glProvisional && (
            <span className="anom-tag" title="opname penutup D+1 belum ada">
              Gain/Losses belum final
            </span>
          )}
        </div>
        <div className="card tbl-card mt4">
          <div className="grid-head cols-sales">
            <span>Produk</span>
            <span className="right">Sales (L)</span>
            <span className="right">Gain/Losses (L)</span>
            <span className="right">Tera (L)</span>
            <span className="right">Omzet (Rp)</span>
          </div>
          {prodDay.length === 0 && (
            <div className="empty-inline">Belum ada penjualan pada tanggal bisnis ini.</div>
          )}
          {sales.rows.map((p) => (
            <div key={p.ckdbbm} className="grid-row cols-sales">
              <span className="text-caption w600">{p.nama}</span>
              <span className="right fs16 num">{idn(p.vol)}</span>
              <span
                className={`right fs16 num ${p.gl !== null && p.gl < 0 ? "t-danger w700" : p.gl !== null && p.gl > 0 ? "t-success" : "t-tertiary"}`}
              >
                {p.gl !== null ? signed(p.gl) : "—"}
              </span>
              <span className="right fs16 t-tertiary num">{p.tera > 0 ? idn(p.tera) : "—"}</span>
              <span className="right fs16 num nowrap">{rp(p.omzet)}</span>
            </div>
          ))}
          <div className="grid-total cols-sales">
            <span className="text-caption w700">TOTAL</span>
            <span className="right w700 num lap-totnum">{idn(totSales)}</span>
            <span className={`right w700 num lap-totnum ${glTotal < 0 ? "t-danger" : "t-success"}`}>
              {signed(glTotal)}
            </span>
            <span className="right fs16 t-tertiary num">{totTera > 0 ? idn(totTera) : "—"}</span>
            <span className="right w700 num nowrap lap-totnum">{rp(totOmzet)}</span>
          </div>
        </div>
        <div className="fs15 t-tertiary mt2">
          {glPctDay === null
            ? "Opname penutup tanggal bisnis ini belum ada. "
            : glProvisional
              ? `Losses harian (metode RESUME: fisik − [stok awal + penerimaan DO − jual bersih]; kekurangan kiriman DO tergabung) ${signed(glTotal)} L berjalan — belum final, menunggu opname penutup${glGarbageCount > 0 ? `; ${glGarbageCount} baris di luar batas wajar dikecualikan` : ""}. `
              : `Losses harian (metode RESUME: fisik − [stok awal + penerimaan DO − jual bersih]; kekurangan kiriman DO tergabung) ${signed(glTotal)} L = ${pct(Math.abs(glPctDay), 2)} dari sales — ambang 100 L / 0,5%${glGarbageCount > 0 ? `; ${glGarbageCount} baris di luar batas wajar dikecualikan (lihat anomali kualitas data)` : ""}. `}
          Bauran NPSO: gasoline {gasMix !== null ? pct(gasMix) : "—"} · gasoil{" "}
          {oilMix !== null ? pct(oilMix) : "—"}.
        </div>
      </div>

      {/* 3 · RECAP HARIAN — Saldo Piutang/Hutang + 6 angka recap (sumber Rincian) */}
      {hasRecap && (
        <div className="mt10">
          <div className="section-h">
            <div className="text-h5 t-brand">Saldo Hutang/Piutang &amp; Recap Harian</div>
            <span className="fs16 t-tertiary">
              saldo dibawa per tanggal bisnis · angka recap dari Rincian Penjualan
            </span>
          </div>

          {hasSaldo && (
            <div className="card tbl-card mt4">
              {saldoRows.map((s) => (
                <div key={s.label} className="grid-row cols-saldo">
                  <span className="text-caption w600">{s.label}</span>
                  <span
                    className={`right fs16 num nowrap ${s.danger ? "t-danger w700" : "t-primary"}`}
                  >
                    {s.danger ? `(${rp(Math.abs(s.val))})` : rp(s.val)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="recap-grid mt4">
            {recapBoxes.map((b) => (
              <div key={b.label} className="card card-pad">
                <div className="fs15 w600 t-tertiary">{b.label}</div>
                <div className="text-h6 num nowrap mt2 t-primary">{rp(b.val)}</div>
                <div className="fs15 t-tertiary mt1">{b.note}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {detail && (
        <>
          {/* 5 + 7 — panel piutang (Domain deposit) di-gate; G/L kumulatif live */}
          <div className={DOMAIN.pelanggan ? "lap-two mt10" : "mt10"}>
            {DOMAIN.pelanggan && (
              <EmptyPanel
                title="Saldo Hutang Piutang Pelanggan"
                domain="Domain deposit &amp; pembayaran pelanggan (pj*)"
                note="Saat tersambung: total piutang, hutang (deposit), dan netto tampil di sini."
              />
            )}
            <div className="card tbl-card">
              <div className="lap-cardhead">
                <div className="text-h6 t-brand">Gain (Losses) Kumulatif</div>
                <span className="fs15 t-tertiary">
                  bulan berjalan · 1–{mi.dayOfMonth} {dateLong(date).split(" ")[2]}
                </span>
                {glPctMonth !== null && (
                  <span className="lap-cardhead-right">
                    <span
                      className={`dot ${Math.abs(glPctMonth) <= 0.005 ? "success" : "danger"}`}
                    />
                    <span className="fs15 t-secondary">
                      {signed(glMonthTotal)} L · {pct(Math.abs(glPctMonth), 2)} —{" "}
                      {Math.abs(glPctMonth) <= 0.005 ? "aman" : "di atas ambang"}
                    </span>
                  </span>
                )}
              </div>
              <div className="grid-head cols-glkum">
                <span>Produk</span>
                <span className="right">G/L bulan (L)</span>
                <span className="right">% vs vol</span>
              </div>
              {glMonthly.rows.map((g) => (
                <div key={g.ckdbbm} className="grid-row cols-glkum">
                  <span className="fs16">{g.nama}</span>
                  <span
                    className={`right fs16 num ${g.selisih < 0 ? (g.selisih < -100 ? "t-danger w700" : "t-danger") : g.selisih > 0 ? "t-success" : "t-tertiary"}`}
                  >
                    {signed(g.selisih)} L
                  </span>
                  <span className="right fs16 t-tertiary num">
                    {g.vol > 0 ? pct(Math.abs(g.selisih) / g.vol, 2) : "—"}
                  </span>
                </div>
              ))}
              {glMonthly.rows.length === 0 && (
                <div className="empty-inline">Belum ada opname penutup bulan ini.</div>
              )}
            </div>
          </div>

          {/* 6 · REALISASI & TARGET */}
          <div className="mt10">
            <div className="section-h">
              <div className="text-h5 t-brand">Realisasi &amp; Target Bulanan</div>
              <span className="fs16 t-tertiary">
                vs prorata alokasi {mi.dayOfMonth} dari {mi.daysInMonth} hari · target dari
                workbook 2026
              </span>
            </div>
            <div className="card tbl-card mt4">
              <div className="grid-head cols-target">
                <span>Produk</span>
                <span className="right">Penjualan Kumulatif</span>
                <span className="right">Rata-rata/hari</span>
                <span className="right">Penerimaan</span>
                <span className="right">Alokasi/bln</span>
                <span className="right">(Kekurangan)/Kelebihan</span>
              </div>
              {target.rows.map((p) => (
                <div key={p.ckdbbm} className="grid-row cols-target">
                  <span className="text-caption w600">{p.nama}</span>
                  <span className="right fs16 num">{fmtL(p.vol)}</span>
                  <span className="right fs16 t-secondary num">{fmtL(p.avgPerDay)}</span>
                  <span className="right fs16 t-secondary num">{fmtL(p.terima)}</span>
                  <span className="right fs16 t-secondary num">
                    {p.alok !== null ? fmtL(p.alok) : "—"}
                  </span>
                  <span
                    className={`right fs16 num ${
                      p.sel === null
                        ? "t-tertiary"
                        : p.sel < -2000
                          ? "t-danger w700"
                          : p.sel < 0
                            ? "t-warning"
                            : "t-success"
                    }`}
                  >
                    {p.sel !== null ? parenNeg(Math.round(p.sel)) : "target belum diisi"}
                  </span>
                </div>
              ))}
              {target.rows.length === 0 && (
                <div className="empty-inline">Belum ada penjualan bulan ini.</div>
              )}
            </div>
          </div>

          {/* 8 + 15 · DO Harian — running-balance outstanding DO (live); panel alokasi di-gate */}
          <div className={DOMAIN.do ? "lap-two mt10" : "mt10"}>
            <div className="card tbl-card">
              <div className="lap-cardhead">
                <div className="text-h6 t-brand">Laporan DO Harian</div>
              </div>
              <div className={`grid-head cols-do${DOMAIN.do ? "" : " lite"}`}>
                <span>Produk</span>
                {DOMAIN.do && <span className="right">DO Awal</span>}
                <span className="right">Penerimaan</span>
                {DOMAIN.do && <span className="right">Penebusan DO</span>}
                {DOMAIN.do && <span className="right">Sisa DO</span>}
              </div>
              {doRows.map((d) => (
                <div key={d.key} className={`grid-row cols-do${DOMAIN.do ? "" : " lite"}`}>
                  <span className="fs16 w600">
                    {d.label}
                    {DOMAIN.do && d.recon !== 0 && (
                      <span
                        className="t-warning"
                        title={`Sisa = DO Awal + Penebusan − Penerimaan ${d.alurSelisih >= 0 ? "+" : "−"} ${fmtL(Math.abs(d.alurSelisih))} yang tak terserap ke SO-nya — rinci di panel Alokasi Penerimaan Tidak Sesuai`}
                      >
                        {" "}⚠
                      </span>
                    )}
                  </span>
                  {DOMAIN.do && <span className="right fs16 t-secondary num">{fmtL(d.doAwal)}</span>}
                  <span className="right fs16 t-secondary num">{fmtL(d.penerimaan)}</span>
                  {DOMAIN.do && <span className="right fs16 t-secondary num">{fmtL(d.penebusan)}</span>}
                  {DOMAIN.do && (
                    <span className={`right fs16 num ${d.recon !== 0 ? "t-warning" : "t-secondary"}`}>
                      {fmtL(d.sisa)}
                      {d.sisaMacet > 0 && (
                        <span className="do-seg text-caption t-warning">
                          {fmtL(d.sisaBerjalan)} berjalan · ⚠ {fmtL(d.sisaMacet)} macet &gt;{DO_STALE_DAYS} hr
                        </span>
                      )}
                      {d.recon !== 0 && alurSelisihNote(d.alurSelisih) && (
                        <span className="do-seg text-caption t-warning">
                          ⚠ {alurSelisihNote(d.alurSelisih)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              ))}
              <div className={`grid-total cols-do${DOMAIN.do ? "" : " lite"}`}>
                <span className="text-caption w700">TOTAL</span>
                {DOMAIN.do && <span className="right w700 num lap-totnum">{fmtL(doTotal.doAwal)}</span>}
                <span className="right w700 num lap-totnum">{fmtL(doTotal.penerimaan)}</span>
                {DOMAIN.do && <span className="right w700 num lap-totnum">{fmtL(doTotal.penebusan)}</span>}
                {DOMAIN.do && (
                  <span className="right w700 num lap-totnum">
                    {fmtL(doTotal.sisa)}
                    {doTotal.sisaMacet > 0 && (
                      <span className="do-seg text-caption t-warning">
                        {fmtL(doTotal.sisa - doTotal.sisaMacet)} berjalan · ⚠ {fmtL(doTotal.sisaMacet)} macet
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="lap-cardfoot">
                {DOMAIN.do
                  ? `Sisa DO = saldo LEDGER PENUH per-SO (Σ ditebus − diterima, ≥0; semua riwayat). DO Awal = Sisa kemarin. ⚠ = alur hari itu tak terserap penuh ke SO-nya: Sisa = DO Awal + Penebusan − Penerimaan + selisih-tak-terserap (tertera di baris; rinci di panel Alokasi). Bagian "macet >${DO_STALE_DAYS} hr" umumnya TIDAK tampil di popup F12 EasyMax; angka headline sengaja tetap ledger penuh.`
                  : "Penerimaan BBM dari data EasyMax."}
              </div>
            </div>
            {DOMAIN.do && (
              <div className="card tbl-card">
                <div className="lap-cardhead">
                  <div className="text-h6 t-brand">Alokasi Penerimaan Tidak Sesuai</div>
                </div>
                {doSuspectRows.length === 0 && suspectsNonaktif.count === 0 && doAnomRows.length === 0 ? (
                  <div className="empty-inline">
                    Tidak ada ketidaksesuaian — semua penerimaan ter-link ke penebusan.
                  </div>
                ) : (
                  <>
                    {(doSuspectRows.length > 0 || suspectsNonaktif.count > 0) && (
                      <>
                        <div className="grid-head cols-suspect">
                          <span>No. SO · Produk</span>
                          <span className="right">Outstanding</span>
                          <span className="right">Sejak</span>
                        </div>
                        {doSuspectRows.map((s) => (
                          <div key={`${s.cnoso}-${s.ckdbbm}`} className="grid-row cols-suspect">
                            <span className="fs16">
                              <span className="w600">{s.cnoso}</span> · {s.nama}
                            </span>
                            <span className="right fs16 t-warning num">{fmtL(s.outstanding)}</span>
                            <span className="right fs16 t-tertiary">
                              {s.sejak} · {s.umur_hari} hr
                            </span>
                          </div>
                        ))}
                        {suspectsNonaktif.count > 0 && (
                          <div className="grid-row cols-suspect">
                            <span className="fs16 t-tertiary">
                              Produk nonaktif (tanpa tangki) · {suspectsNonaktif.count} SO
                            </span>
                            <span className="right fs16 t-tertiary num">
                              {fmtL(suspectsNonaktif.liters)}
                            </span>
                            <span className="right fs16 t-tertiary">ringkasan</span>
                          </div>
                        )}
                      </>
                    )}
                    {doAnomRows.length > 0 && (
                      <>
                        <div className="grid-head cols-anom">
                          <span>Produk</span>
                          <span className="right">Tanpa Penebusan</span>
                          <span className="right">Lebih Terima</span>
                        </div>
                        {doAnomRows.map((a) => (
                          <div key={a.ckdbbm} className="grid-row cols-anom">
                            <span className="fs16 w600">
                              {a.label}
                              {!a.aktif && <span className="text-caption t-tertiary"> · nonaktif</span>}
                            </span>
                            <span className="right fs16 t-warning num">{a.orphan ? fmtL(a.orphan) : "—"}</span>
                            <span className="right fs16 t-warning num">
                              {a.over_receipt ? fmtL(a.over_receipt) : "—"}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
                <div className="lap-cardfoot">
                  DO belum tuntas &gt;{DO_STALE_DAYS} hari = kemungkinan salah input produk/volume di
                  EasyMax — verifikasi &amp; ralat di POS (Sisa per-SO bersih sendiri setelahnya).
                  &ldquo;Tanpa Penebusan&rdquo; = penerimaan ber-SO tanpa penebusan; &ldquo;Lebih
                  Terima&rdquo; = diterima &gt; ditebus per SO.
                </div>
              </div>
            )}
          </div>

          {/* 10 + 11 — harga jual live; panel piutang pelanggan di-gate */}
          <div className={DOMAIN.pelanggan ? "lap-two mt10" : "mt10"}>
            <div className="card tbl-card">
              <div className="lap-cardhead">
                <div className="text-h6 t-brand">{DOMAIN.hargaBeli ? "Harga Beli, Jual & Margin" : "Harga Jual"}</div>
              </div>
              <div className={`grid-head cols-harga${DOMAIN.hargaBeli ? "" : " lite"}`}>
                <span>Produk</span>
                {DOMAIN.hargaBeli && <span className="right">Beli</span>}
                <span className="right">Jual</span>
                {DOMAIN.hargaBeli && <span className="right">Margin</span>}
                {DOMAIN.hargaBeli && <span className="right">%</span>}
              </div>
              {harga.rows.map((p) => (
                <div key={p.ckdbbm} className={`grid-row cols-harga${DOMAIN.hargaBeli ? "" : " lite"}`}>
                  <span className="fs16 w600">{p.nama}</span>
                  {DOMAIN.hargaBeli && <span className="right fs16 t-tertiary num">—</span>}
                  <span className="right fs16 t-secondary num">
                    {p.harga !== null ? rp(p.harga) : "—"}
                  </span>
                  {DOMAIN.hargaBeli && <span className="right fs16 t-tertiary num">—</span>}
                  {DOMAIN.hargaBeli && <span className="right fs16 t-tertiary num">—</span>}
                </div>
              ))}
              <div className="lap-cardfoot">
                {DOMAIN.hargaBeli
                  ? "Harga jual & beli dari data EasyMax."
                  : "Harga jual dari data EasyMax."}
              </div>
            </div>
            {DOMAIN.pelanggan && (
              <EmptyPanel
                title="Pelanggan (Transaksi Piutang Hari Ini)"
                domain="Domain deposit &amp; pembayaran pelanggan"
              />
            )}
          </div>

          {/* 13 + 14 — keduanya domain dorman; seluruh blok di-gate */}
          {(DOMAIN.pendapatanLain || DOMAIN.edc) && (
            <div className="lap-two mt10">
              {DOMAIN.pendapatanLain && (
                <EmptyPanel title="Pendapatan Lain-Lain" domain="modul kas aktif" />
              )}
              {DOMAIN.edc && (
                <EmptyPanel
                  title="EDC"
                  domain="Domain EDC"
                  note="Saat tersambung: nominal vs settlement per channel + selisih disorot."
                />
              )}
            </div>
          )}
        </>
      )}

      {/* 16 · REKONSILIASI — A–I butuh Domain 4–7; di-gate sampai semua siap */}
      {REKON_READY && (
      <div className="rekon-card mt10">
        <div className="alarm-head">
          <div className="text-h5 t-brand">Summary Rekonsiliasi</div>
          <span className="fs16 t-tertiary">
            jantung laporan harian — uang tunai (H) harus sama dengan setoran bank (I)
          </span>
        </div>
        <div className="rekon-grid">
          <div>
            {rekon.rows.map((r) => (
              <div key={r.l} className={`rekon-row${r.em ? " em" : ""}`}>
                <span className={`rekon-badge${r.em ? " em" : ""}`}>{r.l}</span>
                <div className="rekon-label">
                  <span className={`text-body${r.em ? " w700" : ""}`}>{r.label}</span>
                  {r.formula && (
                    <span className="fs15 t-tertiary mono rekon-formula">{r.formula}</span>
                  )}
                </div>
                <span className="fs15 t-tertiary rekon-op">{r.op ?? ""}</span>
                <span
                  className={`num nowrap rekon-val${r.em ? " w700" : ""} ${r.val !== null ? "t-primary" : "t-tertiary"}`}
                >
                  {r.val !== null ? rp(r.val) : "belum tersedia"}
                </span>
              </div>
            ))}
          </div>
          <div className="verdict-box na">
            <div className="verdict-row">
              <span className="verdict-mark na">—</span>
              <div className="text-h6 t-secondary">Rekonsiliasi menunggu Domain 4–7</div>
            </div>
            <div className="fs16 t-secondary mono">H = E + F − G · cocok bila H = I</div>
            <div className="fs15 t-tertiary">
              Komponen B (tera), C (piutang), D (EDC), F (pendapatan lain), dan I (setoran bank)
              belum di pipeline. Saat tersambung, panel ini menampilkan verdict ✓/✗ dan selisih
              H − I — persis seperti rekap manual Google Sheets yang digantikan.
            </div>
          </div>
        </div>
      </div>
      )}

      <div className="page-foot mt8">
        <span>
          Sumber: EasyMax POS · sinkron tiap 1–5 menit · ⟳ = angka pernah dikoreksi
          {corrections > 0 ? ` (${corrections} revisi hari ini)` : ""}
        </span>
        <span>Disusun otomatis oleh SolaMax · menggantikan rekap manual Google Sheets</span>
      </div>
    </div>
  );
}
