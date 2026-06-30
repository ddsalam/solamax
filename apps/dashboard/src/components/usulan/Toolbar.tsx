"use client";

import Link from "next/link";

/** Toolbar Usulan Penebusan SO. Unit & tanggal bisnis dipilih di picker topbar
 *  (terbawa antar layar). `mode` = daftar (riwayat) atau form (edit satu tanggal). */
export function UsulanToolbar({
  code,
  date,
  mode,
}: {
  code: string;
  date: string;
  mode: "list" | "form";
}) {
  return (
    <div className="lap-toolbar no-print">
      {mode === "form" ? (
        <Link href={`/unit/${code}/usulan/${date}`} className="btn-tint sm">
          ← Daftar usulan
        </Link>
      ) : (
        <Link href={`/unit/${code}/usulan/${date}/edit`} className="btn-navy">
          Buat / edit usulan {date}
        </Link>
      )}
      <div className="lap-toolbar-right">
        <button type="button" className="btn-navy" onClick={() => window.print()}>
          Export PDF
        </button>
      </div>
    </div>
  );
}
