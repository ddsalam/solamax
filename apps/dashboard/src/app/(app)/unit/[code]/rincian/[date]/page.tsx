import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RincianToolbar } from "@/components/rincian/Toolbar";
import { classifyProduct, UNIT_DISPLAY, unitDotted, unitLabel } from "@/lib/config";
import { dateLong, dateShort, idn, rp, timeWib } from "@/lib/format";
import { todayWib } from "@/lib/periods";
import { getCashForDate, getSalesByProduct } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface LedgerRow {
  no: string;
  ket: string;
  vol: string;
  rpv: string;
}

interface Section {
  num: string;
  title: string;
  meta: string;
  rows: LedgerRow[];
  totalLabel: string;
  totalVol: string;
  totalRp: string | null;
  naDomain?: string;
}

export default async function RincianPage({
  params,
  searchParams,
}: {
  params: { code: string; date: string };
  searchParams: { kosong?: string };
}) {
  if (!DATE_RE.test(params.date)) notFound();
  const scope = await getDataScope();
  const unit = scope.requireUnit(params.code); // notFound bila di luar scope/tak ada
  const date = params.date;
  const hideEmpty = searchParams.kosong === "sembunyi";

  const units = scope.units;
  const [prod, cash] = await Promise.all([
    getSalesByProduct(unit.unit_id, date, date),
    getCashForDate(unit.unit_id, date),
  ]);

  const ordered = [...prod].sort(
    (a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9),
  );
  const totVol = prod.reduce((s, p) => s + p.vol, 0);
  const A = prod.reduce((s, p) => s + p.omzet, 0);
  const validCash = cash.filter((c) => !c.sbatal);
  const G = validCash.reduce((s, c) => s + (c.ntotal ?? 0), 0);

  let sections: Section[] = [
    {
      num: "1",
      title: "OMSET PENJUALAN",
      meta: "per produk · totalisator nozzle",
      rows: ordered.map((p, i) => ({
        no: String(i + 1),
        ket: p.nama,
        vol: idn(p.vol, 2),
        rpv: rp(p.omzet),
      })),
      totalLabel: "TOTAL OMSET PENJUALAN",
      totalVol: idn(totVol, 2),
      totalRp: rp(A),
    },
    {
      num: "2",
      title: "PELANGGAN",
      meta: "penjualan tempo",
      rows: [],
      totalLabel: "TOTAL PELANGGAN",
      totalVol: "",
      totalRp: null,
      naDomain: "Domain deposit & pembayaran pelanggan",
    },
    {
      num: "3",
      title: "EDC",
      meta: "channel non-tunai",
      rows: [],
      totalLabel: "TOTAL EDC",
      totalVol: "",
      totalRp: null,
      naDomain: "Domain EDC",
    },
    {
      num: "4",
      title: "PENDAPATAN LAIN",
      meta: "",
      rows: [],
      totalLabel: "TOTAL PENDAPATAN LAIN",
      totalVol: "",
      totalRp: null,
      naDomain: "modul kas aktif",
    },
    {
      num: "5",
      title: "PENDAPATAN NON TUNAI",
      meta: "deposit pelanggan · tidak masuk rekonsiliasi tunai",
      rows: [],
      totalLabel: "TOTAL PENDAPATAN NON TUNAI",
      totalVol: "",
      totalRp: null,
      naDomain: "Domain deposit",
    },
    {
      num: "6",
      title: "PENGELUARAN",
      meta: validCash.length > 0 ? `${validCash.length} nota` : "modul kas dorman",
      rows: validCash.map((c, i) => ({
        no: String(i + 1),
        ket: c.vcket ?? c.ckdkb,
        vol: "",
        rpv: c.ntotal !== null ? rp(c.ntotal) : "—",
      })),
      totalLabel: "TOTAL PENGELUARAN",
      totalVol: "",
      totalRp: validCash.length > 0 ? rp(G) : null,
    },
  ];
  if (hideEmpty) sections = sections.filter((s) => s.rows.length > 0);

  const summary: Array<{ l: string; label: string; formula?: string; val: string | null; em?: boolean }> = [
    { l: "A", label: "Omset Penjualan", val: rp(A) },
    { l: "B", label: "Terra / Nozzle Test", val: null },
    { l: "C", label: "Pelanggan", val: null },
    { l: "D", label: "EDC", val: null },
    { l: "E", label: "Penjualan Tunai", formula: "E = A − (B + C + D)", val: null, em: true },
    { l: "F", label: "Pendapatan Lain", val: null },
    { l: "G", label: "Pengeluaran", val: validCash.length > 0 ? rp(G) : null },
    { l: "H", label: "Uang Tunai", formula: "H = E + F − G", val: null, em: true },
    { l: "I", label: "Setoran (Bank)", val: null, em: true },
  ];

  const disp = UNIT_DISPLAY[unit.code];
  const printedAt = `${dateShort(todayWib())} · ${timeWib(new Date().toISOString())}`;

  return (
    <div className="doc-wrap">
      <div className="no-print rincian-links">
        <Link href={`/unit/${unit.code}/laporan/${date}`} className="fs16 w600 t-accent">
          ← Laporan Operasional (versi kaya)
        </Link>
      </div>

      <RincianToolbar
        units={units.map((u) => ({ code: u.code, label: unitLabel(u.code, u.name) }))}
        code={unit.code}
        date={date}
      />

      <div className="doc-sheet mt6">
        {/* Kop */}
        <div className="doc-kop">
          <div>
            <div className="text-h6 t-brand">
              SPBU {unitDotted(unit.code)} · {unit.name}
            </div>
            <div className="fs16 t-secondary mt1 doc-addr">
              {disp?.address ?? "Alamat unit — lengkapi di config"}
            </div>
            <div className="fs15 t-tertiary mt1">{disp?.pt ?? "—"}</div>
          </div>
          <Image src="/solagroup-logo.png" alt="SolaGroup" width={160} height={32} className="doc-logo" />
        </div>

        <div className="doc-titlewrap">
          <div className="text-h4 t-brand doc-title">RINCIAN PENJUALAN</div>
          <div className="doc-date">Tanggal bisnis {dateLong(date)}</div>
        </div>

        {sections.map((sec) => (
          <div key={sec.num} className="doc-section mt10">
            <div className="led-sechead">
              <span className="fs15 w700 t-tertiary num">{sec.num}</span>
              <span className="text-caption w700 t-brand doc-title">{sec.title}</span>
              <span className="led-meta fs15 t-tertiary">{sec.meta}</span>
            </div>
            <div className="led-head">
              <span>No</span>
              <span>Keterangan</span>
              <span className="right">Volume (L)</span>
              <span className="right">Rupiah</span>
            </div>
            {sec.rows.length === 0 ? (
              <div className="led-row">
                <span />
                <span className="fs16 t-tertiary led-empty">
                  {sec.naDomain
                    ? `Belum tersedia di pipeline — menunggu ${sec.naDomain}.`
                    : "Tidak ada transaksi pada tanggal ini."}
                </span>
                <span />
                <span />
              </div>
            ) : (
              <>
                {sec.rows.map((r) => (
                  <div key={`${sec.num}-${r.no}`} className="led-row">
                    <span className="fs16 t-tertiary num">{r.no}</span>
                    <span className="fs16 t-primary">{r.ket}</span>
                    <span className="fs16 right num t-secondary">{r.vol}</span>
                    <span className="fs16 right num nowrap">{r.rpv}</span>
                  </div>
                ))}
                <div className="led-total">
                  <span />
                  <span className="text-caption w700 t-brand">{sec.totalLabel}</span>
                  <span className="fs16 w700 right num">{sec.totalVol}</span>
                  <span className="fs16 w700 right num nowrap">{sec.totalRp ?? ""}</span>
                </div>
              </>
            )}
          </div>
        ))}

        {/* SUMMARY */}
        <div className="doc-section mt12">
          <div className="led-sechead">
            <span className="text-caption w700 t-brand doc-title">SUMMARY</span>
            <span className="led-meta fs15 t-tertiary">rekonsiliasi kas harian</span>
          </div>
          <div className="sum-row sum-head">
            <span className="fs15 w600 t-tertiary">No</span>
            <span className="fs15 w600 t-tertiary">Keterangan</span>
            <span className="fs15 w600 t-tertiary right">Jumlah</span>
          </div>
          {summary.map((s) => (
            <div key={s.l} className={`sum-row${s.em ? " em" : ""}`}>
              <span className="fs16 w700 t-brand num">{s.l}</span>
              <span className="sum-label">
                <span className={`fs16 t-primary${s.em ? " w700" : ""}`}>{s.label}</span>
                {s.formula && <span className="fs15 t-tertiary mono">{s.formula}</span>}
              </span>
              <span className={`fs16 right num nowrap${s.em ? " w700" : ""} ${s.val ? "" : "t-tertiary"}`}>
                {s.val ?? "belum tersedia"}
              </span>
            </div>
          ))}
          <div className="sum-note">
            <span className="dot muted" />
            <span className="fs15 w600 t-tertiary">
              Verifikasi H = I menunggu Domain 4–7 (tera, piutang, EDC, pendapatan lain, setoran)
            </span>
          </div>
        </div>

        {/* Tanda tangan */}
        <div className="sig-grid mt12">
          <div>
            <div className="fs16 t-secondary">Disusun oleh,</div>
            <div className="sig-space" />
            <div className="sig-line">Pengawas SPBU</div>
          </div>
          <div>
            <div className="fs16 t-secondary">Mengetahui,</div>
            <div className="sig-space" />
            <div className="sig-line">Pengawas Wilayah</div>
          </div>
        </div>
        <div className="page-foot mt10">
          <span className="doc-foot">Dihasilkan otomatis oleh SolaMax dari data EasyMax POS</span>
          <span className="doc-foot">Dicetak {printedAt} WIB</span>
        </div>
      </div>
    </div>
  );
}
