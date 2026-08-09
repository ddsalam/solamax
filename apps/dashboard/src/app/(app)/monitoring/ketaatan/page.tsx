import { Heatmap, type HmPending, type HmRow, type HmTone } from "@/components/mon/Heatmap";
import {
  adminStatus,
  opnameStatus,
  pasangkanTetangga,
  salesStatus,
  SETORAN_TOLERANSI_RP,
  type AdminVerdict,
  type Status,
} from "@/lib/compliance";
import { adopsiRincian } from "@/lib/config";
import { rp } from "@/lib/format";
import { todayWib } from "@/lib/periods";
import { getComplianceMatrix, getTankCount } from "@/lib/queries";
import { uangTunai } from "@/lib/rekon";
import { getDataScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

const DAYS = 14;
const TONE: Record<Status, "success" | "warning" | "danger"> = {
  green: "success",
  yellow: "warning",
  red: "danger",
};

/**
 * LEGENDA — memberi label TINGKAT, bukan SEBAB.
 *
 * ⚠️ KENAPA DIUBAH (2026-08-09, temuan owner). Legenda lama menulis
 * "lengkap · sebagian · KOSONG". Tapi sel merah bisa berarti `setoran_tersalin`,
 * `kurang_setor`, `setoran_kosong`, `belum_diisi`, ATAU `config_hilang` — dan
 * hanya dua di antaranya benar-benar tentang kekosongan. Pembaca legenda
 * karenanya membaca satu sebab untuk lima keadaan.
 *
 * Sudah begitu SEBELUM aturan salin-setoran; aturan itu hanya menambah penghuni
 * keenam ke label yang artinya makin longgar. Keluarga yang sama dengan
 * `note.tone` dua-nilai untuk fakta tiga-nilai: KANAL YANG MEMBAWA LEBIH SEDIKIT
 * NILAI DARIPADA FAKTA YANG DITITIPKAN PADANYA.
 *
 * `Record`-nya disengaja: nada baru pada `HmTone`/`HmPending` tanpa entri
 * legenda adalah error type-check, bukan legenda yang diam-diam jadi tak
 * lengkap lagi. Sebabnya tetap ada — di tooltip tiap sel (`adminNote`).
 */
const LEGENDA_NADA: [HmTone, string][] = Object.entries({
  success: "lengkap & selaras",
  warning: "perlu dicek",
  danger: "perlu tindakan",
} satisfies Record<HmTone, string>) as [HmTone, string][];

const LEGENDA_NETRAL: [HmPending, string][] = Object.entries({
  tempo: "belum jatuh tempo",
  "pra-adopsi": "pra-adopsi panel",
} satisfies Record<HmPending, string>) as [HmPending, string][];

/** Nada sel modul: `pending` = netral (belum jatuh tempo / tak bisa dinilai). */
function modTone(t: Status | "pending"): "success" | "warning" | "danger" | "pending" {
  return t === "pending" ? "pending" : TONE[t];
}

/**
 * Agregat sel = modul terburuk hari itu. Perilaku sales/opname DIPERTAHANKAN
 * persis seperti sebelumnya; administrasi ditumpangkan di atasnya sehingga
 * hari yang seksinya kosong BISA memerahkan sel — itu inti indikator ini.
 * `pending` tidak pernah memperburuk (hari berjalan tak dihukum).
 */
function aggregate(
  sales: Status,
  opname: Status,
  admin: Status | "pending",
): "success" | "warning" | "danger" {
  const base: "success" | "warning" | "danger" =
    sales === "red" && opname === "red"
      ? "danger"
      : sales === "green" && opname === "green"
        ? "success"
        : "warning";
  if (admin === "red") return "danger";
  if (admin === "yellow" && base === "success") return "warning";
  return base;
}

/** Catatan manusiawi per verdict — menyebut ANGKA, bukan cuma warna. */
function adminNote(v: AdminVerdict, h: number, i: number | null): string {
  switch (v.kode) {
    case "selaras":
      return `setoran selaras (±${rp(SETORAN_TOLERANSI_RP)})`;
    case "lebih_setor":
      return `setoran MELEBIHI uang tunai ${rp((i ?? 0) - h)}`;
    case "kurang_setor":
      return `setoran kurang ${rp(h - (i ?? 0))}`;
    case "setoran_tersalin":
      return (
        `setoran SAMA PERSIS dengan hari tetangga (${rp(i ?? 0)}) dan meleset ` +
        `${rp(Math.abs((i ?? 0) - h))} dari uang tunai hari ini` +
        (v.komponenIkut ? " · PENDAPATAN LAIN & PENGELUARAN juga identik" : "") +
        " — periksa, kemungkinan angka hari lain terketik di sini"
      );
    case "setoran_kosong":
      return "pendapatan/pengeluaran terisi, SETORAN belum diisi";
    case "belum_diisi":
      return "belum diisi — lewat jatuh tempo (akhir H+1)";
    case "hari_berjalan":
      return "hari berjalan — uang tunai masih dirakit, setoran belum dinilai";
    case "tak_terhitung":
      return "penjualan hari itu tak pernah lengkap — setoran tak bisa dinilai";
    case "belum_tempo_terisi":
      return "sudah diisi · belum jatuh tempo";
    case "belum_tempo_kosong":
      return "belum diisi · belum jatuh tempo (akhir H+1)";
    case "pra_adopsi":
      return "sebelum unit ini memakai panel Rincian — tidak dinilai";
    case "belum_adopsi":
      return "unit ini BELUM memakai panel Rincian sama sekali";
    case "config_hilang":
      return "unit belum terdaftar di ADOPSI_RINCIAN (config) — indikator tak bisa dipercaya untuk unit ini";
  }
}

export default async function KetaatanPage() {
  const scope = await getDataScope();
  const units = scope.units;
  const today = todayWib();

  const rows: HmRow[] = await Promise.all(
    units.map(async (u) => {
      // 2 query/unit. `getLastInputs` dilepas bersama strip kas dorman.
      // DAYS + 1: hari TERTUA diambil semata sebagai benih `iSebelumnya` untuk
      // sel terkiri, lalu dibuang dari tampilan. Tanpa itu, sel terkiri tak
      // pernah bisa diperiksa aturan salin-setoran — lubang senyap yang
      // bergeser satu hari setiap hari, jadi tak akan pernah ada yang sadar.
      const [matrix, tanks] = await Promise.all([
        getComplianceMatrix(u.unit_id, DAYS + 1),
        getTankCount(u.unit_id),
      ]);
      // Pemasangan tetangga (D−1 & D+1) dari lib/compliance.ts — SATU
      // implementasi, teruji, dipakai bersama feed anomali. `.slice(1)`
      // membuang baris benih. Sel terakhir tak punya D+1 dan memang tak
      // membutuhkannya: ia hari ini, dan hari ini tak dinilai.
      const asc = pasangkanTetangga([...matrix].reverse()).slice(1);
      return {
        code: u.code,
        name: u.name,
        cells: asc.map(({ hari: d, tetangga }) => {
          const s = salesStatus(d.shifts);
          const o = opnameStatus(d.tanks, tanks);
          // H dari SUMBER TUNGGAL (lib/rekon.ts) — bukan dihitung ulang di SQL.
          const h = uangTunai({
            A: d.compA,
            B: d.compB,
            C: d.compC,
            D: d.compD,
            F: d.compF,
            G: d.compG,
          });
          const v = adminStatus(
            {
              adopsi: adopsiRincian(u.code),
              nPendapatanLain: d.nPendapatanLain,
              nPengeluaran: d.nPengeluaran,
              nSetoran: d.nSetoran,
              h,
              i: d.setoran,
              f: d.compF,
              g: d.compG,
              tetangga,
              shifts: d.shifts,
            },
            { businessDate: d.d, today },
          );
          return {
            d: d.d,
            tone: aggregate(s, o, v.tone),
            isToday: d.d === today,
            pendingKind:
              v.tone !== "pending"
                ? undefined
                : v.kode === "pra_adopsi"
                  ? ("pra-adopsi" as const)
                  : ("tempo" as const),
            modules: [
              { name: "Penjualan", tone: TONE[s], note: `${d.shifts}/3 shift` },
              { name: "Opname stok", tone: TONE[o], note: `${d.tanks}/${tanks} tangki` },
              {
                name: "Administrasi",
                tone: modTone(v.tone),
                note: `${d.nPendapatanLain}/${d.nPengeluaran}/${d.nSetoran} baris · ${adminNote(v, h, d.setoran)}`,
              },
            ],
          };
        }),
      };
    }),
  );

  const dayLabels = rows[0]?.cells.map((c) => c.d.slice(8)) ?? [];

  return (
    <div>
      <div className="section-h mt6">
        <span className="fs16 t-secondary">
          {units.length} unit × {DAYS} hari · agregat modul input · klik sel untuk detail
        </span>
        <span className="hm-legendrow">
          {LEGENDA_NADA.map(([nada, teks]) => (
            <span key={nada} className="hm-legenditem">
              <span className={`hm-legend ${nada}`} />
              <span className="fs15 t-tertiary">{teks}</span>
            </span>
          ))}
          {LEGENDA_NETRAL.map(([jenis, teks]) => (
            <span key={jenis} className="hm-legenditem">
              <span className={`hm-legend pending${jenis === "pra-adopsi" ? " pra" : ""}`} />
              <span className="fs15 t-tertiary">{teks}</span>
            </span>
          ))}
        </span>
      </div>
      <Heatmap rows={rows} dayLabels={dayLabels} />
      <div className="fs15 t-tertiary mt3">
        <strong>Warna menyatakan TINGKAT, bukan sebab</strong> — satu sel merah bisa
        berarti setoran tak selaras, setoran sama dengan hari tetangga, seksi yang
        belum diisi, atau unit yang belum terdaftar di config. Sebabnya ada di
        tooltip tiap sel. Administrasi = pengisian Rincian Penjualan oleh pengawas (Pendapatan Lain,
        Pengeluaran, Setoran Bank). Setoran dinilai SELARAS bila |I − H| ≤{" "}
        {rp(SETORAN_TOLERANSI_RP)} — setoran bank selalu dibulatkan ke ribuan, jadi
        kesamaan eksak dengan uang tunai tak pernah terjadi.{" "}
        <strong>Tanggal HARI INI tidak dinilai sama sekali</strong> pada sumbu setoran:
        uang tunai (H) masih dirakit sepanjang hari — komponen pelanggan &amp; EDC punya
        watermark sendiri dan terbukti masih tumbuh belasan juta bahkan SETELAH ketiga
        shift tutup. <strong>Hari kemarin dan sebelumnya dinilai SEKETIKA</strong>,
        termasuk bisa langsung merah bila setorannya tak selaras — biayanya nyaris nol
        karena jatuh temponya memang akhir H+1. Yang ditahan
        sampai akhir H+1 hanyalah hari yang <strong>belum diisi</strong> (sel berarsir),
        supaya pengawas tak dihukum karena hari yang memang belum waktunya. Sel bertitik-titik =
        sebelum unit ybs memakai panel Rincian (lantai adopsi beku di config) — bukan
        kelalaian pengawas. Setoran yang <strong>sama persis dengan hari sebelumnya</strong> DAN meleset dari
        uang tunai ditandai merah tersendiri — angka kemarin yang terketik ulang
        pernah terjadi (Korek 2026-08-07) dan tampak wajar sampai dibandingkan.
        Modul kas EasyMax dihapus 2026-08-07 — dorman di ketujuh unit.
      </div>
    </div>
  );
}
