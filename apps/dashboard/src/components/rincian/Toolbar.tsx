"use client";

import { useRouter, useSearchParams } from "next/navigation";

export interface UnitOpt {
  code: string;
  label: string;
}

/** Toolbar Rincian Penjualan (tidak ikut tercetak). */
export function RincianToolbar({
  units,
  code,
  date,
}: {
  units: UnitOpt[];
  code: string;
  date: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Default: section kosong DISEMBUNYIKAN; param ?kosong=tampil membukanya.
  const hideEmpty = params.get("kosong") !== "tampil";

  const go = (c: string, d: string, hide: boolean) =>
    router.push(`/unit/${c}/rincian/${d}${hide ? "" : "?kosong=tampil"}`);

  return (
    <div className="no-print card card-pad rincian-toolbar">
      <select
        className="select"
        value={code}
        onChange={(e) => go(e.target.value, date, hideEmpty)}
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
        onChange={(e) => go(code, e.target.value, hideEmpty)}
        aria-label="Tanggal bisnis"
      />
      <label className="rincian-check">
        <input
          type="checkbox"
          checked={hideEmpty}
          onChange={(e) => go(code, date, e.target.checked)}
        />
        <span className="fs16 t-secondary">Sembunyikan section kosong</span>
      </label>
      <button type="button" className="btn-navy rincian-print" onClick={() => window.print()}>
        Export PDF / Cetak
      </button>
    </div>
  );
}
