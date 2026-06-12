"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export interface UnitOpt {
  code: string;
  label: string;
}

/** Toolbar Laporan Operasional: unit, tanggal bisnis, Ringkas/Lengkap, cetak. */
export function LaporanToolbar({
  units,
  code,
  date,
  detail,
}: {
  units: UnitOpt[];
  code: string;
  date: string;
  detail: boolean;
}) {
  const router = useRouter();
  const view = detail ? "" : "?view=ringkas";

  return (
    <div className="lap-toolbar no-print">
      <select
        className="select"
        value={code}
        onChange={(e) => router.push(`/unit/${e.target.value}/laporan/${date}${view}`)}
        aria-label="Pilih unit"
      >
        {units.map((u) => (
          <option key={u.code} value={u.code}>
            {u.label}
          </option>
        ))}
      </select>
      <input
        className="date-input"
        type="date"
        value={date}
        onChange={(e) => router.push(`/unit/${code}/laporan/${e.target.value}${view}`)}
        aria-label="Tanggal bisnis"
      />
      <span className="fs15 t-tertiary">tanggal bisnis</span>
      <div className="lap-toolbar-right">
        <div className="seg">
          <Link
            href={`/unit/${code}/laporan/${date}?view=ringkas`}
            className={`seg-btn${!detail ? " active" : ""}`}
          >
            Ringkas
          </Link>
          <Link href={`/unit/${code}/laporan/${date}`} className={`seg-btn${detail ? " active" : ""}`}>
            Lengkap
          </Link>
        </div>
        <Link href={`/unit/${code}/rincian/${date}`} className="btn-tint">
          Versi ringkas / Cetak
        </Link>
        <button type="button" className="btn-navy" onClick={() => window.print()}>
          Export PDF
        </button>
      </div>
    </div>
  );
}
