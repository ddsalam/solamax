"use client";

import Link from "next/link";

/** Toolbar Usulan Penebusan SO — view daftar (riwayat). Unit & tanggal bisnis
 *  dipilih di picker topbar. View form memakai UsulanExport (jalur PDF pdfmake).
 *  Ekspor daftar masih via window.print() (di luar lingkup v1 form). */
export function UsulanToolbar({ code, date }: { code: string; date: string }) {
  return (
    <div className="lap-toolbar no-print">
      <Link href={`/unit/${code}/usulan/${date}/edit`} className="btn-navy">
        Buat / edit usulan {date}
      </Link>
      <div className="lap-toolbar-right">
        <button type="button" className="btn-navy" onClick={() => window.print()}>
          Export PDF
        </button>
      </div>
    </div>
  );
}
