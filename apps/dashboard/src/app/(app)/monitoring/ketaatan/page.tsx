import { Heatmap, type HmRow } from "@/components/mon/Heatmap";
import {
  adminStatus,
  opnameStatus,
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
    case "setoran_kosong":
      return "pendapatan/pengeluaran terisi, SETORAN belum diisi";
    case "belum_diisi":
      return "belum diisi — lewat jatuh tempo (akhir H+1)";
    case "tak_terhitung":
      return "penjualan belum lengkap — setoran belum bisa dinilai";
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
      const [matrix, tanks] = await Promise.all([
        getComplianceMatrix(u.unit_id, DAYS),
        getTankCount(u.unit_id),
      ]);
      const asc = [...matrix].reverse();
      return {
        code: u.code,
        name: u.name,
        cells: asc.map((d) => {
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
          <span className="hm-legenditem">
            <span className="hm-legend success" />
            <span className="fs15 t-tertiary">lengkap</span>
          </span>
          <span className="hm-legenditem">
            <span className="hm-legend warning" />
            <span className="fs15 t-tertiary">sebagian</span>
          </span>
          <span className="hm-legenditem">
            <span className="hm-legend danger" />
            <span className="fs15 t-tertiary">kosong</span>
          </span>
          <span className="hm-legenditem">
            <span className="hm-legend pending" />
            <span className="fs15 t-tertiary">belum diisi · belum tempo</span>
          </span>
          <span className="hm-legenditem">
            <span className="hm-legend pending pra" />
            <span className="fs15 t-tertiary">pra-adopsi panel</span>
          </span>
        </span>
      </div>
      <Heatmap rows={rows} dayLabels={dayLabels} />
      <div className="fs15 t-tertiary mt3">
        Administrasi = pengisian Rincian Penjualan oleh pengawas (Pendapatan Lain,
        Pengeluaran, Setoran Bank). Setoran dinilai SELARAS bila |I − H| ≤{" "}
        {rp(SETORAN_TOLERANSI_RP)} — setoran bank selalu dibulatkan ke ribuan, jadi
        kesamaan eksak dengan uang tunai tak pernah terjadi.{" "}
        <strong>Hari yang sudah diisi dinilai SEKETIKA</strong> — termasuk bisa langsung
        merah bila setorannya tak selaras, tanpa menunggu jatuh tempo,{" "}
        <strong>selama ketiga shift-nya sudah masuk</strong>. Selama penjualan belum
        lengkap, uang tunai (H) masih dirakit dan setoran belum dibandingkan dengannya —
        membandingkannya lebih awal memunculkan selisih semu yang besar. Yang ditahan
        sampai akhir H+1 hanyalah hari yang <strong>belum diisi</strong> (sel berarsir),
        supaya pengawas tak dihukum karena hari yang memang belum waktunya. Sel bertitik-titik =
        sebelum unit ybs memakai panel Rincian (lantai adopsi beku di config) — bukan
        kelalaian pengawas. Modul kas EasyMax dihapus 2026-08-07 — dorman di ketujuh unit.
      </div>
    </div>
  );
}
