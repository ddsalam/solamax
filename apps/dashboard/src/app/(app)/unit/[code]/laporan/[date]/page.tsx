import { notFound } from "next/navigation";
import { EmptyPanel } from "@/components/EmptyPanel";
import { LaporanToolbar } from "@/components/laporan/Toolbar";
import {
  canonicalProductKey,
  classifyProduct,
  targetVolumePerDay,
  unitDotted,
} from "@/lib/config";
import { aggregateClosingGl, alarmScore, bauran, glPercent, type AlarmCheck } from "@/lib/derive";
import { DOMAIN, REKON_READY } from "@/lib/flags";
import { dateLong, fmtL, idn, parenNeg, pct, rp, rpShort, signed, timeWib } from "@/lib/format";
import { monthInfo, monthStart, todayWib } from "@/lib/periods";
import {
  getCashForDate,
  getClosingOpname,
  getCorrections,
  getDeliveryByProduct,
  getSalesByProduct,
  getShiftInfo,
  getTankStocks,
  getAvgDailySales,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";
import { enduranceDays, enduranceLevel, stockNow } from "@/lib/derive";
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
    closingDay,
    closingMonth,
    prodMonth,
    delivMonth,
    delivDay,
    shift,
    corrections,
    tanks,
    avg7,
    cash,
  ] = await Promise.all([
    getSalesByProduct(unit.unit_id, date, date),
    getClosingOpname(unit.unit_id, date, date),
    getClosingOpname(unit.unit_id, mStart, date),
    getSalesByProduct(unit.unit_id, mStart, date),
    getDeliveryByProduct(unit.unit_id, mStart, date),
    getDeliveryByProduct(unit.unit_id, date, date),
    getShiftInfo(unit.unit_id, date),
    getCorrections(unit.unit_id, date),
    getTankStocks(unit.unit_id),
    getAvgDailySales(unit.unit_id, addDays(date, -7), addDays(date, -1)),
    getCashForDate(unit.unit_id, date),
  ]);

  const ordered = <T extends { nama: string }>(xs: T[]) =>
    [...xs].sort(
      (a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9),
    );

  const totSales = prodDay.reduce((s, p) => s + p.vol, 0);
  const totOmzet = prodDay.reduce((s, p) => s + p.omzet, 0);
  // G/L SIGNED dari opname penutup (fisik − buku), garbage dikecualikan.
  const aggDay = aggregateClosingGl(closingDay);
  const aggMonth = aggregateClosingGl(closingMonth);
  const glByCode = new Map(
    [...aggDay.byProduct].map(([k, v]) => [k, v.signed] as const),
  );
  const glTotal = aggDay.totalSigned;
  const glPctDay = closingDay.length > 0 ? glPercent(glTotal, totSales) : null;
  const glProvisional = aggDay.provisional;
  const glGarbageCount = aggDay.garbage.length;

  const volMonth = prodMonth.reduce((s, p) => s + p.vol, 0);
  const glMonthTotal = aggMonth.totalSigned;
  const glPctMonth = closingMonth.length > 0 ? glPercent(glMonthTotal, volMonth) : null;

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

  const ok = (label: string, pass: boolean, note: string): AlarmCheck => ({
    label,
    state: pass ? "ok" : "fail",
    note,
  });
  const na = (label: string, domain: string): AlarmCheck => ({
    label,
    state: "na",
    note: `belum tersedia · ${domain}`,
  });
  const checks: AlarmCheck[] = [
    glPctDay === null
      ? na("Losses Harian Aman", "opname penutup belum ada")
      : ok(
          "Losses Harian Aman",
          Math.abs(glTotal) <= 100 && Math.abs(glPctDay) <= 0.005,
          `${signed(glTotal)} L · ${pct(Math.abs(glPctDay), 2)}${glProvisional ? " · provisional" : ""}${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
        ),
    ok(
      "Losses Bulanan Aman",
      glPctMonth === null || Math.abs(glPctMonth) <= 0.005,
      glPctMonth !== null ? `${signed(glMonthTotal)} L · ${pct(Math.abs(glPctMonth), 2)}` : "—",
    ),
    na("Setoran Bank Sesuai", "Domain setoran"),
    hasTarget
      ? ok(
          "Target/Alokasi Sudah Tercapai",
          (worstGap ?? 0) >= 0,
          worstGap !== undefined && worstGap < 0 ? `${parenNeg(worstGap)} vs prorata` : "sesuai prorata",
        )
      : na("Target/Alokasi Sudah Tercapai", "target bulan ini belum diisi"),
    na("Pencatatan DO Sesuai", "Domain DO"),
    na("Pengeluaran Sudah Disahkan", "modul kas dorman"),
    na("Harga Beli/Jual Benar", "master harga beli"),
    na("Saldo Hutang/Piutang Pelanggan Sesuai", "Domain deposit"),
    na("DO Untuk Penerimaan Besok Cukup", "Domain DO"),
    na("Permintaan Besok Sudah Cukup", "Domain DO"),
    na("Settlement EDC Sudah Sesuai", "Domain EDC"),
  ];
  const score = alarmScore(checks);
  const scoreTone = score.ok === score.active ? "t-success" : score.active - score.ok === 1 ? "t-warning" : "t-danger";
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

  // Ringkasan Kas: hanya kartu dengan nilai nyata yang dirender (v1). Kartu
  // domain dorman (val null) muncul kembali otomatis saat datanya masuk.
  const kasCards: Array<{ label: string; val: string | null; note: string }> = [
    { label: "Transaksi Pelanggan", val: null, note: "Domain deposit/piutang" },
    { label: "EDC", val: null, note: "Domain EDC" },
    {
      label: "Pengeluaran",
      val: cash.length > 0 ? rp(cashTotal) : null,
      note: cash.length > 0 ? `${cash.length} nota` : "modul kas dorman",
    },
    { label: "Pendapatan Lain-Lain", val: null, note: "Domain kas aktif" },
    { label: "Setoran Bank", val: null, note: "Domain setoran" },
  ].filter((k) => k.val !== null);

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
            <div className="fs15 t-tertiary">cek sesuai</div>
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
      <div className={`alarm-card mt8${score.active - score.ok > 1 ? " bad" : ""}`}>
        <div className="alarm-head">
          <div className="text-h5 t-brand">Alarm Indikator</div>
          <span className="fs16 t-tertiary">
            cek harian — yang dilihat pertama oleh pengawas &amp; atasan
          </span>
          <span className={`alarm-note w700 num ${scoreTone}`}>{score.text} sesuai</span>
        </div>
        <div className="alarm-grid">
          {visibleChecks.map((c) => (
            <div key={c.label} className="alarm-row">
              <span className={`alarm-mark ${c.state}`}>
                {c.state === "ok" ? "✓" : c.state === "fail" ? "✗" : "—"}
              </span>
              <span
                className={`text-body ${
                  c.state === "fail" ? "t-danger w700" : c.state === "na" ? "t-tertiary" : "t-primary"
                }`}
              >
                {c.label}
              </span>
              <span className={`alarm-note num ${c.state === "fail" ? "t-danger" : "t-tertiary"}`}>
                {c.note}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 2 · OMSET, GAIN(LOSSES), TERA */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Omset Penjualan, Gain (Losses) &amp; Tera Harian</div>
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
            <span className="right">% Mix</span>
          </div>
          {prodDay.length === 0 && (
            <div className="empty-inline">Belum ada penjualan pada tanggal bisnis ini.</div>
          )}
          {ordered(prodDay).map((p) => {
            const gl = glByCode.get(p.ckdbbm) ?? null;
            return (
              <div key={p.ckdbbm} className="grid-row cols-sales">
                <span className="text-caption w600">{p.nama}</span>
                <span className="right fs16 num">{idn(p.vol)}</span>
                <span
                  className={`right fs16 num ${gl !== null && gl < 0 ? "t-danger w700" : gl !== null && gl > 0 ? "t-success" : "t-tertiary"}`}
                >
                  {gl !== null ? signed(gl) : "—"}
                </span>
                <span className="right fs16 t-tertiary num">—</span>
                <span className="right fs16 num nowrap">{rp(p.omzet)}</span>
                <span className="right fs16 t-tertiary num">
                  {totSales > 0 ? pct(p.vol / totSales) : "—"}
                </span>
              </div>
            );
          })}
          <div className="grid-total cols-sales">
            <span className="text-caption w700">TOTAL</span>
            <span className="right w700 num lap-totnum">{idn(totSales)}</span>
            <span className={`right w700 num lap-totnum ${glTotal < 0 ? "t-danger" : "t-success"}`}>
              {signed(glTotal)}
            </span>
            <span className="right t-tertiary num">—</span>
            <span className="right w700 num nowrap lap-totnum">{rp(totOmzet)}</span>
            <span className="right fs16 t-tertiary">100%</span>
          </div>
        </div>
        <div className="fs15 t-tertiary mt2">
          {glPctDay !== null
            ? `Losses harian (opname penutup, fisik − buku) ${signed(glTotal)} L = ${pct(Math.abs(glPctDay), 2)} dari sales — ambang 100 L / 0,5%${glProvisional ? "; angka provisional, opname penutup besok belum ada" : ""}${glGarbageCount > 0 ? `; ${glGarbageCount} baris di luar batas wajar dikecualikan (lihat anomali kualitas data)` : ""}. `
            : "Opname penutup tanggal bisnis ini belum ada. "}
          Bauran NPSO: gasoline {gasMix !== null ? pct(gasMix) : "—"} · gasoil{" "}
          {oilMix !== null ? pct(oilMix) : "—"}. Kolom Tera menunggu domain nozzle-test.
        </div>
      </div>

      {/* 3 · RINGKASAN KAS — hanya kartu dengan nilai nyata (v1) */}
      {kasCards.length > 0 && (
        <div className="mt10">
          <div className="text-h5 t-brand">Ringkasan Kas</div>
          <div className="kas-grid mt4">
            {kasCards.map((k) => (
              <div key={k.label} className="card card-pad">
                <div className="fs15 w600 t-tertiary">{k.label}</div>
                <div className="text-h6 num nowrap mt2 t-primary">{k.val}</div>
                <div className="fs15 t-tertiary mt1">{k.note}</div>
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
                [...aggMonth.byProduct].map(([ckdbbm, v]) => ({
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
              {aggMonth.byProduct.size === 0 && (
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

          {/* 8 + 15 · DO — kartu DO live (penerimaan nyata); panel alokasi di-gate */}
          <div className={DOMAIN.do ? "lap-two mt10" : "mt10"}>
            <div className="card tbl-card">
              <div className="lap-cardhead">
                <div className="text-h6 t-brand">Laporan DO Harian</div>
              </div>
              <div className="grid-head cols-do">
                <span>Produk</span>
                <span className="right">DO Awal</span>
                <span className="right">Penerimaan</span>
                <span className="right">Penebusan</span>
                <span className="right">Sisa DO Akhir</span>
              </div>
              {ordered(delivDay).map((d) => (
                <div key={d.ckdbbm} className="grid-row cols-do">
                  <span className="fs16 w600">{d.nama}</span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-secondary num">{fmtL(d.vol)}</span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-tertiary num">—</span>
                </div>
              ))}
              {delivDay.length === 0 && (
                <div className="empty-inline">Tidak ada penerimaan BBM pada tanggal ini.</div>
              )}
              <div className="lap-cardfoot">
                Kolom DO awal/penebusan/sisa menunggu Domain DO (MyPertamina). Penerimaan = data
                nyata tr_terimabbm.
              </div>
            </div>
            {DOMAIN.do && (
              <EmptyPanel
                title="Alokasi Penerimaan Tidak Sesuai"
                domain="Domain DO/alokasi"
                note="Saat tersambung: hanya produk dengan ketidaksesuaian 5 hari terakhir yang tampil."
              />
            )}
          </div>

          {/* 9 · STOK & KETAHANAN */}
          <div className="mt10">
            <div className="section-h">
              <div className="text-h5 t-brand">Sisa &amp; Ketahanan Stock &amp; DO</div>
              <span className="fs16 t-tertiary">
                ketahanan = sisa stock ÷ rata-rata jual 7 hari
                {oldestOpname ? ` · dihitung dari opname ${timeWib(oldestOpname)} + penjualan tersinkron` : ""}
              </span>
            </div>
            <div className="card tbl-card mt4">
              <div className="grid-head cols-stock">
                <span>Produk</span>
                <span className="right">Sisa Stock</span>
                <span className="right">Ketahanan</span>
                <span className="right">Sisa DO</span>
                <span className="right">Plan Terima Hari Ini</span>
                <span className="right">Plan Minta Besok</span>
                <span className="right">Usulan Beli DO</span>
              </div>
              {stockRows.map((s) => (
                <div key={s.ckdbbm} className="grid-row cols-stock">
                  <span className="text-caption w600">{s.nama}</span>
                  <span className="right fs16 num">{s.stock !== null ? fmtL(s.stock) : "—"}</span>
                  <span
                    className={`right fs16 num ${
                      s.level === "danger"
                        ? "t-danger w700"
                        : s.level === "warning"
                          ? "t-warning w700"
                          : "t-primary"
                    }`}
                  >
                    {s.days !== null ? `${idn(s.days, 1)} hari` : "—"}
                  </span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-tertiary num">—</span>
                </div>
              ))}
              {stockRows.length === 0 && (
                <div className="empty-inline">Belum ada data tangki/opname.</div>
              )}
            </div>
            <div className="fs15 t-tertiary mt2">
              Kolom DO &amp; plan menunggu Domain DO/penebusan.
            </div>
          </div>

          {/* 10 + 11 — harga jual live; panel piutang pelanggan di-gate */}
          <div className={DOMAIN.pelanggan ? "lap-two mt10" : "mt10"}>
            <div className="card tbl-card">
              <div className="lap-cardhead">
                <div className="text-h6 t-brand">Harga Beli, Jual &amp; Margin</div>
              </div>
              <div className="grid-head cols-harga">
                <span>Produk</span>
                <span className="right">Beli</span>
                <span className="right">Jual</span>
                <span className="right">Margin</span>
                <span className="right">%</span>
              </div>
              {ordered(prodDay).map((p) => (
                <div key={p.ckdbbm} className="grid-row cols-harga">
                  <span className="fs16 w600">{p.nama}</span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-secondary num">
                    {p.harga !== null ? rp(p.harga) : "—"}
                  </span>
                  <span className="right fs16 t-tertiary num">—</span>
                  <span className="right fs16 t-tertiary num">—</span>
                </div>
              ))}
              <div className="lap-cardfoot">
                Harga jual = data EasyMax. Harga beli &amp; margin menunggu master harga beli.
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
