import Link from "next/link";
import { HubPicker } from "@/components/HubPicker";
import { unitLabel } from "@/lib/config";
import { ago } from "@/lib/format";
import { todayWib } from "@/lib/periods";
import { getSyncByUnit } from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

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

  // Garis kesegaran: kapan data unit terpilih terakhir tersinkron (pengganti
  // banner "X dari 9 modul" — kelengkapan modul disembunyikan untuk v1).
  let lastSync: string | null = null;
  if (unit) {
    try {
      lastSync =
        (await getSyncByUnit([unit.unit_id]))
          .map((s) => s.last_run)
          .filter((x): x is string => x !== null)
          .sort()
          .pop() ?? null;
    } catch {
      // DB tak terjangkau — halaman tetap render tanpa garis kesegaran.
    }
  }

  // 6 kartu pintasan, dikelompokkan sama persis dengan grup sidebar. Kartu
  // per-unit memakai unit & tanggal terpilih dari HubPicker; Fase 3 mengangkat
  // pilihan ini ke topbar yang terbawa antar layar.
  const u = unit?.code;
  const groups = [
    {
      title: "Monitoring realtime",
      cards: [
        {
          tag: "Realtime",
          title: "Denah tangki & nozzle",
          desc: "Volume ATG live, fill bar, ketahanan hari & nozzle per tangki.",
          href: u ? `/monitoring/denah/${u}` : "#",
        },
        {
          tag: "Realtime",
          title: "Ketaatan administrasi",
          desc: "Heatmap kepatuhan input penjualan, opname & kas per hari.",
          href: "/monitoring/ketaatan",
        },
      ],
    },
    {
      title: "Laporan",
      cards: [
        {
          tag: "Harian",
          title: "Operasional harian",
          desc: "Alarm indikator, omset & gain/loss per produk, target, ketahanan stok.",
          href: u ? `/unit/${u}/laporan/${date}` : "#",
        },
        {
          tag: "Arsip",
          title: "Rincian penjualan",
          desc: "Ledger resmi siap cetak & tanda tangan.",
          href: u ? `/unit/${u}/rincian/${date}` : "#",
        },
      ],
    },
    {
      title: "Direksi & admin",
      cards: [
        {
          tag: "Analisa",
          title: "Ringkasan direksi",
          desc: "Verdict kesehatan grup, KPI, bauran vs target, ranking unit, anomali.",
          href: "/board",
        },
        {
          tag: "Admin",
          title: "Kelola akses",
          desc: "Undang & atur peran pengguna dashboard.",
          href: "/admin",
        },
      ],
    },
  ];

  return (
    <div>
      <div className="text-eyebrow t-tertiary">Beranda</div>
      <h1 className="text-h4 t-brand mt2">Pilih unit &amp; tanggal, lalu buka modul</h1>

      <div className="picker-row mt6">
        <HubPicker
          units={units.map((u2) => ({ code: u2.code, label: unitLabel(u2.code, u2.name) }))}
          date={date}
        />
      </div>

      <div className="fs16 t-secondary mt5">
        <span className={`dot ${lastSync ? "success" : "muted"}`} />{" "}
        {lastSync ? `Data terakhir masuk ${ago(lastSync)}.` : "Menunggu data tersinkron."}
      </div>

      {groups.map((g) => (
        <div key={g.title} className="mt8">
          <div className="text-eyebrow t-tertiary">{g.title}</div>
          <div className="launch-card-grid mt4">
            {g.cards.map((c) => (
              <Link key={c.title} href={c.href} className="hub-card">
                <div className="hub-card-top">
                  <span className="tag-pill">{c.tag}</span>
                  <span className="t-tertiary">→</span>
                </div>
                <div className="text-h6 t-brand mt4">{c.title}</div>
                <p className="fs16 t-secondary mt2">{c.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
