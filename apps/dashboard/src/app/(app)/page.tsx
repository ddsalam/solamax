import Link from "next/link";
import { HubPicker } from "@/components/HubPicker";
import { unitLabel } from "@/lib/config";
import { todayWib } from "@/lib/periods";
import { getComplianceMatrix } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const STEPS = [
  { n: "1", label: "Pilih unit & tanggal", hi: true },
  { n: "2", label: "Buka ringkasan / laporan" },
  { n: "3", label: "Drilldown sampai nozzle" },
  { n: "4", label: "Export / arsip" },
];

const MODULE_TOTAL = 9;

export default async function HubPage({
  searchParams,
}: {
  searchParams: { unit?: string; date?: string };
}) {
  const scope = await getDataScope();
  const units = scope.units;
  const today = todayWib();
  const unit = units.find((u) => u.code === searchParams.unit) ?? units[0];
  const date = searchParams.date ?? today;

  // Banner kelengkapan: modul terisi dari 9 (3 shift + opname + kas + 4 domain belum)
  let filled = 0;
  if (unit && date === today) {
    const m = (await getComplianceMatrix(unit.unit_id, 1))[0];
    if (m) filled = Math.min(m.shifts, 3) + (m.tanks > 0 ? 1 : 0) + (m.cash_rows > 0 ? 1 : 0);
  }

  const cards = [
    {
      tag: "Analisa grup",
      title: "Ringkasan Direksi",
      desc: "Verdict kesehatan grup, KPI, bauran NPSO/PSO vs target, ranking unit, feed anomali.",
      roles: "Direksi · Admin Area",
      href: `/board`,
    },
    {
      tag: "Alat kerja harian",
      title: "Laporan Operasional Harian",
      desc: "Alarm indikator, omset & gain/loss per produk, target, ketahanan stok, rekonsiliasi A–I.",
      roles: "Semua persona",
      href: unit ? `/unit/${unit.code}/laporan/${date}` : "#",
    },
    {
      tag: "Dokumen arsip",
      title: "Rincian Penjualan Harian",
      desc: "Ledger resmi siap cetak & tanda tangan — omset, pelanggan, EDC, pengeluaran, summary A–I.",
      roles: "Pengawas · Ops · arsip",
      href: unit ? `/unit/${unit.code}/rincian/${date}` : "#",
    },
  ];

  return (
    <div>
      <div className="text-eyebrow t-tertiary">Laporan &amp; Analisa</div>
      <h1 className="text-h4 t-brand mt2">Pilih unit &amp; tanggal, lalu turun selapis demi selapis</h1>

      <div className="step-strip mt5">
        {STEPS.map((s, i) => (
          <div key={s.n} className="step-strip">
            <div className={`step-pill${s.hi ? " hi" : ""}`}>
              <span className="step-num">{s.n}</span>
              <span className={`fs15 w600 ${s.hi ? "t-accent" : "t-primary"}`}>{s.label}</span>
            </div>
            {i < STEPS.length - 1 && <span className="t-tertiary">→</span>}
          </div>
        ))}
      </div>

      <div className="picker-row mt6">
        <HubPicker
          units={units.map((u) => ({ code: u.code, label: unitLabel(u.code, u.name) }))}
          date={date}
        />
      </div>

      {unit && date === today && filled < MODULE_TOTAL && (
        <div className="banner warning mt5">
          <span className="dot lg warning" />
          <div>
            <div className="text-caption w600 t-warning">
              Data tanggal ini belum lengkap — {filled} dari {MODULE_TOTAL} modul terisi
            </div>
            <div className="fs16 t-secondary mt1">
              Shift 3 tutup besok pagi; modul EDC/setoran/piutang menunggu pipeline Domain 4–7.
              Laporan tetap bisa dibuka dengan angka berjalan.
            </div>
          </div>
        </div>
      )}

      <div className="hub-grid mt6">
        {cards.map((c) => (
          <Link key={c.title} href={c.href} className="hub-card">
            <div className="hub-card-top">
              <span className="tag-pill">{c.tag}</span>
              <span className="t-tertiary">→</span>
            </div>
            <div className="text-h6 t-brand mt4">{c.title}</div>
            <p className="fs16 t-secondary mt2">{c.desc}</p>
            <div className="fs15 t-tertiary mt4">{c.roles}</div>
          </Link>
        ))}
      </div>

      <div className="mt8">
        <Link href="/monitoring" className="btn-navy">
          Lanjut ke Monitoring Realtime →
        </Link>
      </div>
    </div>
  );
}
