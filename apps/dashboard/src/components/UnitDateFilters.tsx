"use client";

/**
 * Filter MILIK HALAMAN untuk rute per-unit (rincian / laporan / usulan / denah).
 *
 * Menggantikan picker global di topbar. Prinsipnya sama dengan BoardFilters &
 * HarianFilters — komponen ini hanya MEMBANGUN URL; URL tetap satu-satunya
 * sumber kebenaran halaman, dan otorisasi unit tetap di server (requireUnit →
 * notFound). Tidak ada cookie yang ditulis dari sini: cookie "unit/tanggal
 * terakhir dipakai" digeser oleh write-through navigasi (useSelection), jadi
 * seed titik-masuk tetap ikut tanpa jadi kendali kedua.
 *
 * Hanya dimensi yang BENAR-BENAR dipakai halaman yang dirender:
 *   - denah realtime → unit saja + teks konteks (tanpa kontrol tanggal);
 *   - scope 1 unit  → dimensi unit degenerate → chip konteks, bukan dropdown.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import { addDays } from "@/lib/periods";
import { unitRouteHref, type UnitRouteSegment } from "@/lib/unit-route";

export interface FilterUnitOpt {
  code: string;
  name: string;
  dotted: string;
}

export function UnitDateFilters({
  units,
  code,
  segment,
  edit,
  date,
  today,
  maxDate,
  note,
}: {
  /** Unit dalam scope caller (dari getDataScope) — daftar pilihan. */
  units: FilterUnitOpt[];
  /** Unit aktif (dari path — kanonik). */
  code: string;
  segment: UnitRouteSegment;
  /** true = sedang di form usulan (`/edit`); sub-rute dipertahankan. */
  edit?: boolean;
  /** Tanggal bisnis aktif. Absen = halaman tanpa dimensi tanggal. */
  date?: string;
  /** Hari ini WIB dari server — target tombol "Hari ini". */
  today?: string;
  /**
   * Batas atas pemilih tanggal. Sengaja OPSIONAL: laporan/rincian melaporkan
   * masa lalu (tak ada data besok → dibatasi hari ini), sedangkan Usulan
   * Penebusan adalah RENCANA dan sejak dulu boleh diberi tanggal ke depan —
   * membatasinya di sini akan diam-diam mengubah alur kerja, bukan tampilan.
   */
  maxDate?: string;
  /** Teks konteks singkat di ujung baris (mis. penjelasan realtime). */
  note?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const query = sp.toString();
  const nav = (over: { code?: string; date?: string }) => {
    detailsRef.current?.removeAttribute("open");
    router.push(
      unitRouteHref({
        segment,
        code: over.code ?? code,
        date: over.date ?? date,
        edit,
        query,
      }),
    );
  };

  const active = units.find((u) => u.code === code);
  const activeLabel = active?.name ?? code;

  const shift = (days: number) => {
    if (!date) return;
    const next = addDays(date, days);
    if (maxDate && next > maxDate) return;
    nav({ date: next });
  };

  return (
    <div className="board-filters no-print">
      {units.length > 1 ? (
        <details ref={detailsRef} className="unit-picker">
          <summary className="btn-outline unit-picker-btn">
            <span className="fs15 t-tertiary">Unit</span>
            <span className="fs16 w600">{activeLabel}</span>
            <span className="t-tertiary">▾</span>
          </summary>
          <div className="unit-picker-panel card" role="group" aria-label="Pilih unit">
            {units.map((u) => (
              <label key={u.code} className="unit-picker-row">
                <input
                  type="radio"
                  name="filter-unit"
                  value={u.code}
                  checked={u.code === code}
                  onChange={() => nav({ code: u.code })}
                />
                <span className="fs16 t-primary">{u.name}</span>
                <span className="fs15 t-tertiary mono">{u.dotted}</span>
              </label>
            ))}
          </div>
        </details>
      ) : (
        // Satu unit dalam scope: tak ada yang bisa dipilih — tampilkan konteks,
        // bukan kontrol yang tak pernah mengubah apa pun.
        <span className="filter-static">
          <span className="fs15 t-tertiary">Unit</span>
          <span className="fs16 w600 t-primary">{activeLabel}</span>
          {active && <span className="fs15 t-tertiary mono">{active.dotted}</span>}
        </span>
      )}

      {date && (
        <div className="range-inputs">
          <label htmlFor="filter-date" className="fs15 t-tertiary">
            Tanggal
          </label>
          <button
            type="button"
            className="btn-outline"
            onClick={() => shift(-1)}
            aria-label="Hari sebelumnya"
          >
            ‹
          </button>
          <input
            id="filter-date"
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => e.target.value && nav({ date: e.target.value })}
          />
          <button
            type="button"
            className="btn-outline"
            onClick={() => shift(1)}
            disabled={maxDate !== undefined && date >= maxDate}
            aria-label="Hari berikutnya"
          >
            ›
          </button>
          {today !== undefined && date !== today && (
            <button type="button" className="btn-tint sm" onClick={() => nav({ date: today })}>
              Hari ini
            </button>
          )}
        </div>
      )}

      {note && <span className="filter-note fs15 t-tertiary">{note}</span>}
    </div>
  );
}
