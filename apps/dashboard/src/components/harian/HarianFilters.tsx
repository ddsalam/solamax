"use client";

/**
 * Filter Laporan Harian — SELURUH state di URL searchParams (?d=…&units=…).
 * Komponen ini hanya MEMBANGUN URL; otorisasi unit terjadi di server
 * (parseHarianParams ∩ getDataScope). Tak ada cookie, tak ada state bayangan —
 * pelajaran desync picker (PR #73): satu sumber kebenaran saja.
 */
import { useRouter } from "next/navigation";
import { harianParamsToQuery } from "@/lib/harian-params";

export interface HarianFilterUnit {
  code: string;
  name: string;
  dotted: string;
}

export function HarianFilters({
  units,
  selected,
  allUnits,
  date,
  maxDate,
  defaultDate,
}: {
  units: HarianFilterUnit[];
  selected: string[];
  allUnits: boolean;
  date: string;
  /** Batas atas pemilih tanggal = hari ini WIB. */
  maxDate: string;
  /** Kemarin WIB — target tombol "Kemarin". */
  defaultDate: string;
}) {
  const router = useRouter();

  const nav = (over: { date?: string; unitCodes?: string[] }) => {
    const unitCodes = over.unitCodes ?? selected;
    router.push(
      `/laporan-harian${harianParamsToQuery({
        date: over.date ?? date,
        unitCodes,
        allUnits: unitCodes.length === units.length,
      })}`,
    );
  };

  const toggleUnit = (code: string) => {
    const has = selected.includes(code);
    if (has && selected.length === 1) return; // minimal 1 unit
    nav({ unitCodes: has ? selected.filter((c) => c !== code) : [...selected, code] });
  };

  const shift = (days: number) => {
    const t = new Date(`${date}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + days);
    const next = t.toISOString().slice(0, 10);
    if (next > maxDate) return;
    nav({ date: next });
  };

  const unitLabel = allUnits
    ? `Semua unit (${units.length})`
    : selected.length === 1
      ? (units.find((u) => u.code === selected[0])?.name ?? selected[0])
      : `${selected.length} unit dipilih`;

  return (
    <div className="board-filters no-print">
      <details className="unit-picker">
        <summary className="btn-outline unit-picker-btn">
          <span className="fs15 t-tertiary">Unit</span>
          <span className="fs16 w600">{unitLabel}</span>
          <span className="t-tertiary">▾</span>
        </summary>
        <div className="unit-picker-panel card">
          {units.map((u) => {
            const checked = selected.includes(u.code);
            return (
              <label key={u.code} className="unit-picker-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={checked && selected.length === 1}
                  onChange={() => toggleUnit(u.code)}
                />
                <span className="fs16 t-primary">{u.name}</span>
                <span className="fs15 t-tertiary mono">{u.dotted}</span>
              </label>
            );
          })}
          <div className="unit-picker-foot">
            <button
              type="button"
              className="fs15 w600 t-accent linklike"
              onClick={() => nav({ unitCodes: units.map((u) => u.code) })}
            >
              Pilih semua
            </button>
          </div>
        </div>
      </details>

      <div className="range-inputs">
        <button type="button" className="btn-outline" onClick={() => shift(-1)} aria-label="Hari sebelumnya">
          ‹
        </button>
        <input
          type="date"
          value={date}
          max={maxDate}
          onChange={(e) => e.target.value && nav({ date: e.target.value })}
          aria-label="Tanggal laporan"
        />
        <button
          type="button"
          className="btn-outline"
          onClick={() => shift(1)}
          disabled={date >= maxDate}
          aria-label="Hari berikutnya"
        >
          ›
        </button>
        {date !== defaultDate && (
          <button type="button" className="btn-tint sm" onClick={() => nav({ date: defaultDate })}>
            Kemarin
          </button>
        )}
      </div>
    </div>
  );
}
