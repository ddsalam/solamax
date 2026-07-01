import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ManualEntryForm } from "@/components/rincian/ManualEntryForm";
import { RincianToolbar } from "@/components/rincian/Toolbar";
import { classifyProduct, UNIT_DISPLAY, unitDotted } from "@/lib/config";
import { REKON_READY } from "@/lib/flags";
import { dateLong, dateShort, idn, rp, timeWib } from "@/lib/format";
import { todayWib } from "@/lib/periods";
import {
  getDepositForDate,
  getEdcBlankCard,
  getEdcForDate,
  getManualEntries,
  getPelangganForDate,
  getSalesByProduct,
  getTerraResmiForDate,
} from "@/lib/queries";
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
  // v1: section kosong (Domain 4–7) disembunyikan secara default; tampilkan
  // hanya bila diminta eksplisit (?kosong=tampil). Begitu sebuah section dapat
  // baris nyata, ia muncul kembali otomatis (filter di bawah = "has rows").
  const hideEmpty = searchParams.kosong !== "tampil";

  const [prod, terra, pelanggan, edc, edcBlank, deposit, pendapatanLain, pengeluaran, setoranTunai] =
    await Promise.all([
      getSalesByProduct(unit.unit_id, date, date),
      getTerraResmiForDate(unit.unit_id, date),
      getPelangganForDate(unit.unit_id, date),
      getEdcForDate(unit.unit_id, date),
      getEdcBlankCard(unit.unit_id, date),
      getDepositForDate(unit.unit_id, date),
      getManualEntries(unit.unit_id, date, "pendapatan_lain"),
      getManualEntries(unit.unit_id, date, "pengeluaran"),
      getManualEntries(unit.unit_id, date, "setoran_tunai"),
    ]);

  const ordered = [...prod].sort(
    (a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9),
  );
  const totVol = prod.reduce((s, p) => s + p.vol, 0);
  // Summary A–I (rekon kas; B Terra & I Setoran di luar lingkup v1 → null).
  const A = prod.reduce((s, p) => s + p.omzet, 0);
  // B Terra/Nozzle Test = Σ ledger RESMI terra_resmi (DTGLTERRA, sbatal=0). SUMBER
  // TUNGGAL (sama dgn kolom Tera Laporan & net-sales G/L). Rekon eksak 8/8 hari.
  const teraLiter = terra.reduce((s, r) => s + r.liter, 0);
  const B = terra.reduce((s, r) => s + r.rp, 0);
  const pelLiter = pelanggan.reduce((s, r) => s + r.liter, 0);
  const C = pelanggan.reduce((s, r) => s + r.rp, 0);
  const D = edc.reduce((s, r) => s + r.rp, 0);
  const depTotal = deposit.reduce((s, r) => s + r.rp, 0);
  const F = pendapatanLain.reduce((s, r) => s + r.amount, 0);
  const G = pengeluaran.reduce((s, r) => s + r.amount, 0);
  const E = A - (B + C + D); // Penjualan Tunai
  const H = E + F - G; // Uang Tunai
  // I = Setoran Tunai (input pengawas; total slip non-void). null bila belum ada
  // entri → baris I & indikator disembunyikan (pola hide-null summary). Indikator:
  // I < H → warning merah (setoran kurang dari kas); I >= H → check hijau (lunas).
  const I = setoranTunai.length > 0 ? setoranTunai.reduce((s, r) => s + r.amount, 0) : null;
  const setoranOk = I !== null && I >= H;

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
      title: "TERRA",
      meta: "tera resmi / nozzle test · dikurangkan dari Penjualan Tunai (B)",
      rows: terra.map((r, i) => ({
        no: String(i + 1),
        ket: r.nama ?? r.ckdbbm ?? "—",
        vol: idn(r.liter, 2),
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL TERRA",
      totalVol: idn(teraLiter, 2),
      totalRp: rp(B),
    },
    {
      num: "3",
      title: "PELANGGAN",
      meta: "penjualan tempo (RFID/deposit ⊎ voucher)",
      rows: pelanggan.map((r, i) => ({
        no: String(i + 1),
        ket: r.nama ?? r.ckdplg ?? "—",
        vol: idn(r.liter, 2),
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL PELANGGAN",
      totalVol: idn(pelLiter, 2),
      totalRp: rp(C),
    },
    {
      num: "4",
      title: "EDC",
      meta:
        edcBlank.rp > 0
          ? `channel non-tunai · ⚠ blank-card ${rp(edcBlank.rp)} (${edcBlank.n} txn, di luar total)`
          : "channel non-tunai",
      rows: edc.map((r, i) => ({
        no: String(i + 1),
        ket: r.nama,
        vol: "",
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL EDC",
      totalVol: "",
      totalRp: rp(D),
    },
    {
      num: "5",
      title: "PENDAPATAN LAIN",
      meta: "input pengawas",
      rows: pendapatanLain.map((r, i) => ({
        no: String(i + 1),
        ket: r.keterangan,
        vol: "",
        rpv: rp(r.amount),
      })),
      totalLabel: "TOTAL PENDAPATAN LAIN",
      totalVol: "",
      totalRp: rp(F),
    },
    {
      num: "6",
      title: "PENDAPATAN NON TUNAI",
      meta: "deposit pelanggan · tidak masuk rekonsiliasi tunai",
      rows: deposit.map((r, i) => ({
        no: String(i + 1),
        ket: r.vcket ?? r.ckdplg ?? "—",
        vol: "",
        rpv: rp(r.rp),
      })),
      totalLabel: "TOTAL PENDAPATAN NON TUNAI",
      totalVol: "",
      totalRp: rp(depTotal),
    },
    {
      num: "7",
      title: "PENGELUARAN",
      meta: "input pengawas",
      rows: pengeluaran.map((r, i) => ({
        no: String(i + 1),
        ket: r.keterangan,
        vol: "",
        rpv: rp(r.amount),
      })),
      totalLabel: "TOTAL PENGELUARAN",
      totalVol: "",
      totalRp: rp(G),
    },
  ];
  if (hideEmpty) sections = sections.filter((s) => s.rows.length > 0);

  const summary: Array<{
    l: string;
    label: string;
    formula?: string;
    val: string | null;
    em?: boolean;
    note?: { tone: "ok" | "warn"; text: string };
  }> = [
    { l: "A", label: "Omset Penjualan", val: rp(A) },
    { l: "B", label: "Terra / Nozzle Test", val: rp(B) },
    { l: "C", label: "Pelanggan", val: rp(C) },
    { l: "D", label: "EDC", val: rp(D) },
    { l: "E", label: "Penjualan Tunai", formula: "E = A − (B + C + D)", val: rp(E), em: true },
    { l: "F", label: "Pendapatan Lain", val: rp(F) },
    { l: "G", label: "Pengeluaran", val: rp(G) },
    { l: "H", label: "Uang Tunai", formula: "H = E + F − G", val: rp(H), em: true },
    {
      l: "I",
      label: "Setoran Tunai",
      val: I !== null ? rp(I) : null,
      em: true,
      note:
        I === null
          ? undefined
          : setoranOk
            ? { tone: "ok", text: "Setoran menutup uang tunai (I ≥ H)" }
            : { tone: "warn", text: `Setoran kurang dari uang tunai (I < H, selisih ${rp(H - I)})` },
    },
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

      <RincianToolbar code={unit.code} date={date} />

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
          <Logo variant="horizontal" height={32} className="doc-logo" />
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
                  Tidak ada transaksi pada tanggal ini.
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
          {/* v1: tampilkan hanya baris dengan nilai nyata; baris A–I "belum
              tersedia" (Domain 4–7) disembunyikan dan kembali otomatis saat
              nilainya terisi. */}
          {summary
            .filter((s) => s.val !== null)
            .map((s) => (
              <div key={s.l} className={`sum-row${s.em ? " em" : ""}`}>
                <span className="fs16 w700 t-brand num">{s.l}</span>
                <span className="sum-label">
                  <span className={`fs16 t-primary${s.em ? " w700" : ""}`}>{s.label}</span>
                  {s.formula && <span className="fs15 t-tertiary mono">{s.formula}</span>}
                  {s.note && (
                    <span className={`fs15 w600 ${s.note.tone === "ok" ? "t-success" : "t-danger"}`}>
                      <span className={`dot ${s.note.tone === "ok" ? "success" : "danger"}`} />{" "}
                      {s.note.tone === "ok" ? "✓ " : "⚠ "}
                      {s.note.text}
                    </span>
                  )}
                </span>
                <span className={`fs16 right num nowrap${s.em ? " w700" : ""}`}>{s.val}</span>
              </div>
            ))}
          {REKON_READY && (
            <div className="sum-note">
              <span className="dot muted" />
              <span className="fs15 w600 t-tertiary">
                Verifikasi H = I dari komponen tera, piutang, EDC, pendapatan lain &amp; setoran
              </span>
            </div>
          )}
        </div>

        {/* Input manual (no-print) — Pendapatan Lain & Pengeluaran diisi pengawas.
            Tulis via server action ber-scope; edit = batalkan + tambah. */}
        <div className="no-print manual-panel mt12">
          <div className="fs15 w700 t-tertiary">Input manual (pengawas) · tidak ikut cetak</div>
          <ManualEntryForm
            code={unit.code}
            date={date}
            section="pendapatan_lain"
            title="4 · Pendapatan Lain"
            entries={pendapatanLain}
          />
          <ManualEntryForm
            code={unit.code}
            date={date}
            section="pengeluaran"
            title="6 · Pengeluaran"
            entries={pengeluaran}
          />
          <ManualEntryForm
            code={unit.code}
            date={date}
            section="setoran_tunai"
            title="I · Setoran Tunai (disetor ke bank)"
            entries={setoranTunai}
          />
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
