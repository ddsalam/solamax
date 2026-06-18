"use client";

import Link from "next/link";

/** Toolbar Laporan Operasional: hanya Ringkas/Lengkap + cetak. Unit & tanggal
 *  bisnis dipilih sekali di picker topbar (terbawa antar layar). */
export function LaporanToolbar({
  code,
  date,
  detail,
}: {
  code: string;
  date: string;
  detail: boolean;
}) {
  return (
    <div className="lap-toolbar no-print">
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
      <div className="lap-toolbar-right">
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
