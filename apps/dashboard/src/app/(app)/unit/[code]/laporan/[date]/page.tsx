import { notFound } from "next/navigation";
import { EmptyPanel } from "@/components/EmptyPanel";
import { LaporanToolbar } from "@/components/laporan/Toolbar";
import {
  canonicalProductKey,
  classifyProduct,
  DO_PRODUCTS,
  resolveDoProduct,
  targetVolumePerDay,
  unitDotted,
} from "@/lib/config";
import { aggregateDailyGl, alarmScore, bauran, glPercent, type AlarmCheck } from "@/lib/derive";
import { DOMAIN, REKON_READY } from "@/lib/flags";
import { dateLong, fmtL, idn, parenNeg, pct, rp, rpShort, signed, timeWib } from "@/lib/format";
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
  getTankStocks,
  getAvgDailySales,
  getSaldoPelanggan,
  getPelangganForDate,
  getEdcForDate,
  getDepositForDate,
  getManualEntries,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import { enduranceDays, enduranceLevel, isStockImplausible, stockNow } from "@/lib/derive";
import { addDays } from "@/lib/periods";

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
  const isToday = date === today;
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
    tanks,
    avg7,
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
    getTankStocks(unit.unit_id),
    getAvgDailySales(unit.unit_id, addDays(date, -7), addDays(date, -1)),
    getCashForDate(unit.unit_id, date),
    getSaldoPelanggan(unit.unit_id, date),
    getPelangganForDate(unit.unit_id, date),
    getEdcForDate(unit.unit_id, date),
    getDepositForDate(unit.unit_id, date),
    getManualEntries(unit.unit_id, date, "pendapatan_lain"),
    getManualEntries(unit.unit_id, date, "pengeluaran"),
    getManualEntries(unit.unit_id, date, "setoran_tunai"),
  ]);

  const ordered = <T extends { nama: string }>(xs: T[]) =>
    [...xs].sort(
      (a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9),
    );

  // Laporan DO Harian — 6 produk TETAP (urutan referensi). Sisa/DO Awal = per-SO
  // OTORITATIF (getDoHarian v2, logika F12; TANPA δ-seed). Baris dirender walau 0.
  // `recon` = (DO Awal + Penebusan − Penerimaan) − Sisa: ≠0 → hari anomali (selisih
  // = orphan/over-receipt, detail di panel "Alokasi Penerimaan Tidak Sesuai").
  // TOTAL = jumlah BENAR semua 6 produk (termasuk Pertamina Dex).
  const doRows = DO_PRODUCTS.map((dp) => {
    const r = doDay.find((x) => resolveDoProduct(x.nama)?.key === dp.key);
    const doAwal = r?.do_awal ?? 0;
    const penerimaan = r?.penerimaan ?? 0;
    const penebusan = r?.penebusan ?? 0;
    const sisa = r?.sisa ?? 0;
    return {
      key: dp.key,
      label: dp.label,
      doAwal,
      penerimaan,
      penebusan,
      sisa,
      recon: Math.round(doAwal + penebusan - penerimaan - sisa),
    };
  });
  const doTotal = doRows.reduce(
    (a, r) => ({
      doAwal: a.doAwal + r.doAwal,
      penerimaan: a.penerimaan + r.penerimaan,
      penebusan: a.penebusan + r.penebusan,
      sisa: a.sisa + r.sisa,
    }),
    { doAwal: 0, penerimaan: 0, penebusan: 0, sisa: 0 },
  );
  // Anomali alokasi DO (orphan + over-receipt) per produk — untuk panel.
  const doAnomRows = ordered(
    doAnomalies.map((a) => ({ ...a, label: resolveDoProduct(a.nama)?.label ?? a.nama })),
  );

  const totSales = prodDay.reduce((s, p) => s + p.vol, 0);
  const totOmzet = prodDay.reduce((s, p) => s + p.omzet, 0);
  // G/L harian metode RESUME: Fisik − (Fisik D−1 + ΣNVOLDO − jual BERSIH). Sales
  // (L) & Omzet tetap KOTOR/utuh; Tera hanya mengoreksi Penjualan_BERSIH di G/L.
  const dayAgg = aggregateDailyGl(glRows.filter((r) => r.d === date));
  const monthAgg = aggregateDailyGl(glRows);
  const glByCode = new Map(
    [...dayAgg.byProduct].map(([k, v]) => [k, v.signed] as const),
  );
  const teraByCode = new Map(
    [...dayAgg.byProduct].map(([k, v]) => [k, v.tera] as const),
  );
  const glTotal = dayAgg.totalSigned;
  const totTera = dayAgg.totalTera;
  const glPctDay = dayAgg.hasGl ? glPercent(glTotal, totSales) : null;
  const glProvisional = dayAgg.provisional;
  const glGarbageCount = dayAgg.excludedTanks;

  const volMonth = prodMonth.reduce((s, p) => s + p.vol, 0);
  const glMonthTotal = monthAgg.totalSigned;
  const glPctMonth = monthAgg.hasGl ? glPercent(glMonthTotal, volMonth) : null;

  const isPartial = isToday && shift.shifts < 3;
  const gasMix = bauran(prodDay, "gasoline");
  const oilMix = bauran(prodDay, "gasoil");

  // ===== Alarm (3 cek aktif, 8 menunggu data — №6) =====
  const targetGap = prodMonth.map((p) => {
    const perDay = targetVolumePerDay(unit.code, mi.month, p.nama);
    return perDay !== null ? p.vol - perDay * mi.dayOfMonth : null;
  });
  const worstGap = targetGap.filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
  const hasTarget = targetGap.some((x) => x !== null);

  const na = (label: string, domain: string): AlarmCheck => ({
    label,
    state: "na",
    note: `belum tersedia · ${domain}`,
  });

  // Cek 1 — Losses harian. Partial-day = PROVISIONAL: %-nya artefak denominator
  // kecil (mis. 136,90%), jadi tampilkan L berjalan TANPA % dan jangan klaim
  // aman/gagal. Label mengikuti status (aman / di atas ambang / sementara).
  const dailyLoss = (): AlarmCheck => {
    if (glPctDay === null)
      return { label: "Losses harian — menunggu opname", state: "na", note: "opname penutup belum ada" };
    if (glProvisional)
      return {
        label: "Losses harian — sementara",
        state: "provisional",
        note: `${signed(glTotal)} L berjalan · belum final, menunggu opname penutup${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
      };
    const within = Math.abs(glTotal) <= 100 && Math.abs(glPctDay) <= 0.005;
    return {
      label: within ? "Losses harian aman" : "Losses harian di atas ambang",
      state: within ? "ok" : "fail",
      note: `${signed(glTotal)} L · ${pct(Math.abs(glPctDay), 2)}${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
    };
  };

  const monthlyWithin = glPctMonth === null || Math.abs(glPctMonth) <= 0.005;
  const monthlyLoss: AlarmCheck = {
    label: monthlyWithin ? "Losses bulanan aman" : "Losses bulanan di atas ambang",
    state: monthlyWithin ? "ok" : "fail",
    note: glPctMonth !== null ? `${signed(glMonthTotal)} L · ${pct(Math.abs(glPctMonth), 2)}` : "—",
  };

  const targetCheck = (): AlarmCheck => {
    if (!hasTarget)
      return { label: "Target bulan ini — belum diisi", state: "na", note: "target bulan ini belum diisi" };
    const met = (worstGap ?? 0) >= 0;
    return {
      label: met ? "Target bulan ini tercapai" : "Target bulan ini di bawah prorata",
      state: met ? "ok" : "fail",
      note: worstGap !== undefined && worstGap < 0 ? `${parenNeg(worstGap)} vs prorata` : "sesuai prorata",
    };
  };

  const checks: AlarmCheck[] = [
    dailyLoss(),
    monthlyLoss,
    na("Setoran Bank Sesuai", "Domain setoran"),
    targetCheck(),
    na("Pencatatan DO Sesuai", "Domain DO"),
    na("Pengeluaran Sudah Disahkan", "modul kas dorman"),
    na("Harga Beli/Jual Benar", "master harga beli"),
    na("Saldo Hutang/Piutang Pelanggan Sesuai", "Domain deposit"),
    na("DO Untuk Penerimaan Besok Cukup", "Domain DO"),
    na("Permintaan Besok Sudah Cukup", "Domain DO"),
    na("Settlement EDC Sudah Sesuai", "Domain EDC"),
  ];
  const score = alarmScore(checks);
  // fail≥2 → danger; tepat 1 fail → warning; tanpa fail tapi ada provisional → warning.
  const scoreTone =
    score.fail >= 2
      ? "t-danger"
      : score.fail === 1
        ? "t-warning"
        : score.provisional > 0
          ? "t-warning"
          : "t-success";
  // v1: tampilkan hanya cek yang datanya tersedia (state !== "na"). Cek "na"
  // muncul kembali otomatis begitu datanya masuk. alarmScore sudah
  // mengecualikan "na" dari pembilang/penyebut → tak ada perubahan matematika.
  const visibleChecks = checks.filter((c) => c.state !== "na");

  // ===== Stok =====
  const avgBy = new Map(avg7.map((a) => [a.ckdbbm, a.avg_vol]));
  const byProduct = new Map<
    string,
    { nama: string; stock: number | null; opAt: string | null }
  >();
  for (const t of tanks) {
    const key = t.ckdbbm ?? t.ckdtangki;
    const stock = stockNow(t.stock_op, t.sold_since, t.received_since);
    const cur = byProduct.get(key);
    byProduct.set(key, {
      nama: t.nama ?? key,
      stock: cur?.stock != null || stock != null ? (cur?.stock ?? 0) + (stock ?? 0) : null,
      opAt: cur?.opAt && t.opname_at ? (cur.opAt < t.opname_at ? cur.opAt : t.opname_at) : (cur?.opAt ?? t.opname_at),
    });
  }
  const stockRows = ordered(
    Array.from(byProduct.entries()).map(([ckdbbm, v]) => {
      const days = enduranceDays(v.stock, avgBy.get(ckdbbm) ?? 0);
      return { ckdbbm, nama: v.nama, stock: v.stock, days, level: enduranceLevel(days), opAt: v.opAt };
    }),
  );
  const oldestOpname = tanks
    .map((t) => t.opname_at)
    .filter((x): x is string => x !== null)
    .sort()[0];

  const cashTotal = cash.filter((c) => !c.sbatal).reduce((s, c) => s + (c.ntotal ?? 0), 0);

  // ===== RECAP HARIAN — Saldo Piutang/Hutang + 6 angka recap =====
  // Saldo: dari domain piutang/hutang (formula terkunci probe 11-13). Enam angka
  // recap = REUSE penuh sumber Rincian Penjualan (tak menarik ulang EasyMax):
  // Pelanggan (vw_jualplg⊎vw_usevouc), EDC (vw_edc3), Transfer (= Pendapatan Non
  // Tunai / deposit), dan 3 input manual pengawas (pengeluaran/pendapatan_lain/
  // setoran_tunai = "Setoran Bank") dari app.manual_entry.
  const recapBoxes: Array<{ label: string; val: number; note: string }> = [
    { label: "Transaksi Pelanggan", val: recapPelanggan.reduce((s, r) => s + r.rp, 0), note: "penjualan tempo (RFID/voucher)" },
    { label: "Pengeluaran", val: recapPengeluaran.reduce((s, r) => s + r.amount, 0), note: "input pengawas" },
    { label: "EDC", val: recapEdc.reduce((s, r) => s + r.rp, 0), note: "non-tunai per channel" },
    { label: "Pendapatan Lain", val: recapPendapatanLain.reduce((s, r) => s + r.amount, 0), note: "input pengawas" },
    { label: "Transfer", val: recapDeposit.reduce((s, r) => s + r.rp, 0), note: "deposit / non-tunai" },
    { label: "Setoran Bank", val: recapSetoran.reduce((s, r) => s + r.amount, 0), note: "disetor ke bank (pengawas)" },
  ];
  const saldoRows: Array<{ label: string; val: number; danger?: boolean }> = [
    { label: "Saldo Piutang Pelanggan Lokal", val: saldo.piutangLokal },
    { label: "Saldo Piutang Pelanggan Online", val: saldo.piutangOnline },
    { label: "Saldo Hutang Pelanggan Lokal", val: saldo.hutangLokal, danger: true },
  ];
  const hasSaldo = saldo.piutangLokal !== 0 || saldo.piutangOnline !== 0 || saldo.hutangLokal !== 0;
  const hasRecap = hasSaldo || recapBoxes.some((b) => b.val !== 0);

  return (
    <div className="lap-page">
      <LaporanToolbar code={unit.code} date={date} detail={detail} />

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
          {ordered(prodDay).map((p) => {
            const gl = glByCode.get(p.ckdbbm) ?? null;
            const tera = teraByCode.get(p.ckdbbm) ?? 0;
            return (
              <div key={p.ckdbbm} className="grid-row cols-sales">
                <span className="text-caption w600">{p.nama}</span>
                <span className="right fs16 num">{idn(p.vol)}</span>
                <span
                  className={`right fs16 num ${gl !== null && gl < 0 ? "t-danger w700" : gl !== null && gl > 0 ? "t-success" : "t-tertiary"}`}
                >
                  {gl !== null ? signed(gl) : "—"}
                </span>
                <span className="right fs16 t-tertiary num">{tera > 0 ? idn(tera) : "—"}</span>
                <span className="right fs16 num nowrap">{rp(p.omzet)}</span>
              </div>
            );
          })}
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
              {ordered(
                [...monthAgg.byProduct].map(([ckdbbm, v]) => ({
                  ckdbbm,
                  nama: v.nama ?? ckdbbm,
                  selisih: v.signed,
                })),
              ).map((g) => {
                const vol = prodMonth.find((p) => p.ckdbbm === g.ckdbbm)?.vol ?? 0;
                return (
                  <div key={g.ckdbbm} className="grid-row cols-glkum">
                    <span className="fs16">{g.nama}</span>
                    <span
                      className={`right fs16 num ${g.selisih < 0 ? (g.selisih < -100 ? "t-danger w700" : "t-danger") : g.selisih > 0 ? "t-success" : "t-tertiary"}`}
                    >
                      {signed(g.selisih)} L
                    </span>
                    <span className="right fs16 t-tertiary num">
                      {vol > 0 ? pct(Math.abs(g.selisih) / vol, 2) : "—"}
                    </span>
                  </div>
                );
              })}
              {monthAgg.byProduct.size === 0 && (
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
              {ordered(prodMonth).map((p) => {
                const perDay = targetVolumePerDay(unit.code, mi.month, p.nama);
                const alok = perDay !== null ? perDay * mi.daysInMonth : null;
                const sel = perDay !== null ? p.vol - perDay * mi.dayOfMonth : null;
                const terima = delivMonth.find((d) => canonicalProductKey(d.nama) === canonicalProductKey(p.nama))?.vol ?? 0;
                return (
                  <div key={p.ckdbbm} className="grid-row cols-target">
                    <span className="text-caption w600">{p.nama}</span>
                    <span className="right fs16 num">{fmtL(p.vol)}</span>
                    <span className="right fs16 t-secondary num">
                      {fmtL(p.vol / mi.dayOfMonth)}
                    </span>
                    <span className="right fs16 t-secondary num">{fmtL(terima)}</span>
                    <span className="right fs16 t-secondary num">
                      {alok !== null ? fmtL(alok) : "—"}
                    </span>
                    <span
                      className={`right fs16 num ${
                        sel === null
                          ? "t-tertiary"
                          : sel < -2000
                            ? "t-danger w700"
                            : sel < 0
                              ? "t-warning"
                              : "t-success"
                      }`}
                    >
                      {sel !== null ? parenNeg(Math.round(sel)) : "target belum diisi"}
                    </span>
                  </div>
                );
              })}
              {prodMonth.length === 0 && (
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
                        title={`Alur tak rekonsiliasi (${signed(d.recon)} L) — alokasi tidak sesuai; lihat panel`}
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
                    </span>
                  )}
                </div>
              ))}
              <div className={`grid-total cols-do${DOMAIN.do ? "" : " lite"}`}>
                <span className="text-caption w700">TOTAL</span>
                {DOMAIN.do && <span className="right w700 num lap-totnum">{fmtL(doTotal.doAwal)}</span>}
                <span className="right w700 num lap-totnum">{fmtL(doTotal.penerimaan)}</span>
                {DOMAIN.do && <span className="right w700 num lap-totnum">{fmtL(doTotal.penebusan)}</span>}
                {DOMAIN.do && <span className="right w700 num lap-totnum">{fmtL(doTotal.sisa)}</span>}
              </div>
              <div className="lap-cardfoot">
                {DOMAIN.do
                  ? "Sisa DO = saldo per-SO (Σ ditebus − diterima, ≥0; logika EasyMax). DO Awal = Sisa kemarin. ⚠ = alur tak sesuai Sisa (alokasi tidak sesuai). Penerimaan = Volume DO (NVOLDO)."
                  : "Penerimaan BBM dari data EasyMax."}
              </div>
            </div>
            {DOMAIN.do && (
              <div className="card tbl-card">
                <div className="lap-cardhead">
                  <div className="text-h6 t-brand">Alokasi Penerimaan Tidak Sesuai</div>
                </div>
                {doSuspects.length === 0 && doAnomRows.length === 0 ? (
                  <div className="empty-inline">
                    Tidak ada ketidaksesuaian — semua penerimaan ter-link ke penebusan.
                  </div>
                ) : (
                  <>
                    {doSuspects.length > 0 && (
                      <>
                        <div className="grid-head cols-suspect">
                          <span>No. SO · Produk</span>
                          <span className="right">Outstanding</span>
                          <span className="right">Sejak</span>
                        </div>
                        {doSuspects.map((s) => (
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
                            <span className="fs16 w600">{a.label}</span>
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

          {/* 9 · STOK & KETAHANAN */}
          <div className="mt10">
            <div className="section-h">
              <div className="text-h5 t-brand">Sisa &amp; Ketahanan Stock{DOMAIN.do ? " & DO" : ""}</div>
              <span className="fs16 t-tertiary">
                ketahanan = sisa stock ÷ rata-rata jual 7 hari
                {oldestOpname ? ` · dihitung dari opname ${timeWib(oldestOpname)} + penjualan tersinkron` : ""}
              </span>
            </div>
            <div className="card tbl-card mt4">
              <div className={`grid-head cols-stock${DOMAIN.do ? "" : " lite"}`}>
                <span>Produk</span>
                <span className="right">Sisa Stock</span>
                <span className="right">Ketahanan</span>
                {DOMAIN.do && <span className="right">Sisa DO</span>}
                {DOMAIN.do && <span className="right">Plan Terima Hari Ini</span>}
                {DOMAIN.do && <span className="right">Plan Minta Besok</span>}
                {DOMAIN.do && <span className="right">Usulan Beli DO</span>}
              </div>
              {stockRows.map((s) => {
                const bad = isStockImplausible(s.stock);
                return (
                  <div key={s.ckdbbm} className={`grid-row cols-stock${DOMAIN.do ? "" : " lite"}`}>
                    <span className="text-caption w600">{s.nama}</span>
                    <span className={`right fs16 num ${bad ? "t-warning" : ""}`}>
                      {bad ? "data tak wajar" : s.stock !== null ? fmtL(s.stock) : "—"}
                    </span>
                    <span
                      className={`right fs16 num ${
                        bad
                          ? "t-warning"
                          : s.level === "danger"
                            ? "t-danger w700"
                            : s.level === "warning"
                              ? "t-warning w700"
                              : "t-primary"
                      }`}
                    >
                      {bad ? "—" : s.days !== null ? `${idn(s.days, 1)} hari` : "—"}
                    </span>
                    {DOMAIN.do && <span className="right fs16 t-tertiary num">—</span>}
                    {DOMAIN.do && <span className="right fs16 t-tertiary num">—</span>}
                    {DOMAIN.do && <span className="right fs16 t-tertiary num">—</span>}
                    {DOMAIN.do && <span className="right fs16 t-tertiary num">—</span>}
                  </div>
                );
              })}
              {stockRows.length === 0 && (
                <div className="empty-inline">Belum ada data tangki/opname.</div>
              )}
            </div>
            {DOMAIN.do && (
              <div className="fs15 t-tertiary mt2">
                Kolom DO &amp; plan dari Domain DO/penebusan.
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
              {ordered(prodDay).map((p) => (
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

          {/* 12 · PENGELUARAN */}
          <div className="mt10">
            <div className="section-h">
              <div className="text-h5 t-brand">Pengeluaran Harian</div>
              <span className="fs16 t-tertiary">
                modul kas — struktur siap; dorman menunggu input kembali di EasyMax
              </span>
            </div>
            <div className="card tbl-card mt4">
              <div className="grid-head cols-keluar">
                <span>Keterangan</span>
                <span>Kategori</span>
                <span />
                <span />
                <span className="right">Nominal</span>
              </div>
              {cash.map((c) => (
                <div key={c.ckdkb} className={`grid-row cols-keluar${c.sbatal ? " lap-batal" : ""}`}>
                  <span className="fs16 w600">{c.vcket ?? c.ckdkb}</span>
                  <span className="fs16 t-secondary">{c.kategori ?? "—"}</span>
                  <span />
                  <span />
                  <span className="right fs16 num nowrap">
                    {c.ntotal !== null ? rp(c.ntotal) : "—"}
                    {c.sbatal ? " · dibatalkan" : ""}
                  </span>
                </div>
              ))}
              {cash.length === 0 && (
                <div className="empty-inline">
                  Tidak ada nota kas pada tanggal ini — modul dorman (lihat feed anomali).
                </div>
              )}
              {cash.length > 0 && (
                <div className="grid-total cols-keluar">
                  <span className="text-caption w700">Total hari ini</span>
                  <span />
                  <span />
                  <span />
                  <span className="right w700 num nowrap lap-totnum">{rp(cashTotal)}</span>
                </div>
              )}
            </div>
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
            {[
              { l: "A", label: "Omset Penjualan", val: rp(totOmzet), em: false, op: "" },
              { l: "B", label: "Tera / Nozzle Test", val: null, op: "−" },
              { l: "C", label: "Pelanggan (piutang)", val: null, op: "−" },
              { l: "D", label: "EDC", val: null, op: "−" },
              { l: "E", label: "Penjualan Tunai", val: null, em: true, formula: "E = A − (B + C + D)" },
              { l: "F", label: "Pendapatan Lain", val: null, op: "+" },
              { l: "G", label: "Pengeluaran", val: cash.length > 0 ? rp(cashTotal) : null, op: "−" },
              { l: "H", label: "Uang Tunai", val: null, em: true, formula: "H = E + F − G" },
              { l: "I", label: "Setoran Bank", val: null, em: true },
            ].map((r) => (
              <div key={r.l} className={`rekon-row${r.em ? " em" : ""}`}>
                <span className={`rekon-badge${r.em ? " em" : ""}`}>{r.l}</span>
                <div className="rekon-label">
                  <span className={`text-body${r.em ? " w700" : ""}`}>{r.label}</span>
                  {"formula" in r && r.formula && (
                    <span className="fs15 t-tertiary mono rekon-formula">{r.formula}</span>
                  )}
                </div>
                <span className="fs15 t-tertiary rekon-op">{r.op ?? ""}</span>
                <span className={`num nowrap rekon-val${r.em ? " w700" : ""} ${r.val ? "t-primary" : "t-tertiary"}`}>
                  {r.val ?? "belum tersedia"}
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
