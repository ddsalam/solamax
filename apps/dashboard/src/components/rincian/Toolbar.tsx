"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Toolbar Rincian Penjualan (tidak ikut tercetak): sembunyikan section kosong
 *  + cetak. Unit & tanggal bisnis dipilih di picker topbar. */
export function RincianToolbar({ code, date }: { code: string; date: string }) {
  const router = useRouter();
  const params = useSearchParams();
  // Default: section kosong DISEMBUNYIKAN; param ?kosong=tampil membukanya.
  const hideEmpty = params.get("kosong") !== "tampil";

  const toggle = (hide: boolean) =>
    router.push(`/unit/${code}/rincian/${date}${hide ? "" : "?kosong=tampil"}`);

  return (
    <div className="no-print card card-pad rincian-toolbar">
      <label className="rincian-check">
        <input type="checkbox" checked={hideEmpty} onChange={(e) => toggle(e.target.checked)} />
        <span className="fs16 t-secondary">Sembunyikan section kosong</span>
      </label>
      <button type="button" className="btn-navy rincian-print" onClick={() => window.print()}>
        Export PDF / Cetak
      </button>
    </div>
  );
}
