import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/Logo";
import { ManualEntryForm } from "@/components/rincian/ManualEntryForm";
import { RincianExport } from "@/components/rincian/RincianExport";
import { UNIT_DISPLAY, unitDotted } from "@/lib/config";
import { REKON_READY } from "@/lib/flags";
import { dateLong, dateShort, timeWib } from "@/lib/format";
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
import { buildRincianModel } from "@/lib/rincian-model";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // SUMBER TUNGGAL: model dipakai render layar (di bawah) DAN ekspor PDF →
  // angka identik (rekon ke rupiah). Data sudah ber-scope (ScopedUnitId).
  const model = buildRincianModel({
    prod,
    terra,
    pelanggan,
    edc,
    edcBlank,
    deposit,
    pendapatanLain,
    pengeluaran,
    setoranTunai,
  });
  const sections = hideEmpty
    ? model.sections.filter((s) => s.rows.length > 0)
    : model.sections;
  const summary = model.summary;

  const disp = UNIT_DISPLAY[unit.code];
  const generatedDate = todayWib();
  const printedAt = `${dateShort(generatedDate)} · ${timeWib(new Date().toISOString())}`;
  const exportMeta = {
    unitDotted: unitDotted(unit.code),
    unitName: unit.name,
    address: disp?.address ?? "Alamat unit — lengkapi di config",
    pt: disp?.pt ?? "—",
    dateLong: dateLong(date),
    generatedLabel: printedAt,
  };

  return (
    <div className="doc-wrap">
      <div className="no-print rincian-links">
        <Link href={`/unit/${unit.code}/laporan/${date}`} className="fs16 w600 t-accent">
          ← Laporan Operasional (versi kaya)
        </Link>
      </div>

      <RincianExport
        code={unit.code}
        businessDate={date}
        generatedDate={generatedDate}
        model={model}
        meta={exportMeta}
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
