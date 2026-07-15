"use client";

/**
 * Baris filter board direksi — SEMUA state di URL searchParams (shareable):
 * ?units=…&p=…&from=…&to=…&mode=… . Komponen ini hanya MEMBANGUN URL; otorisasi
 * unit terjadi di server (parseBoardParams ∩ getDataScope) — mencentang unit di
 * luar scope lewat URL tidak berefek (intersect-fallback).
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { boardParamsToQuery, type BoardMode } from "@/lib/board-params";
import type { BoardPeriodKey } from "@/lib/periods";

export interface FilterUnit {
  code: string;
  name: string;
  dotted: string;
}

const PRESETS: Array<{ key: BoardPeriodKey; label: string }> = [
  { key: "today", label: "Hari ini" },
  { key: "7d", label: "7 hari" },
  { key: "30d", label: "30 hari" },
  { key: "bulan", label: "Bulan ini" },
  { key: "custom", label: "Custom" },
];

export function BoardFilters({
  units,
  selected,
  allUnits,
  pkey,
  from,
  to,
  mode,
  today,
}: {
  units: FilterUnit[];
  selected: string[]; // kode unit terpilih (hasil intersect server)
  allUnits: boolean;
  pkey: BoardPeriodKey;
  from: string;
  to: string;
  mode: BoardMode;
  today: string;
}) {
  const router = useRouter();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // draft rentang custom — dinavigasikan saat "Terapkan" (bukan per-ketikan)
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(to);

  const nav = (over: Partial<{ unitCodes: string[]; p: string; from: string; to: string; mode: BoardMode }>) => {
    const unitCodes = over.unitCodes ?? selected;
    const p = over.p ?? pkey;
    const q = boardParamsToQuery({
      unitCodes,
      allUnits: unitCodes.length === units.length,
      p,
      from: over.from ?? dFrom,
      to: over.to ?? dTo,
      mode: over.mode ?? mode,
    });
    router.push(`/board${q}`);
  };

  const toggleUnit = (code: string) => {
    const has = selected.includes(code);
    if (has && selected.length === 1) return; // minimal 1 unit
    const next = has ? selected.filter((c) => c !== code) : [...selected, code];
    nav({ unitCodes: next });
  };

  const unitLabel =
    allUnits ? `Semua unit (${units.length})` : selected.length === 1
      ? (units.find((u) => u.code === selected[0])?.name ?? selected[0])
      : `${selected.length} unit dipilih`;

  return (
    <div className="board-filters no-print">
      {/* Checklist unit multi-pilih */}
      <details ref={detailsRef} className="unit-picker">
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
            <button
              type="button"
              className="fs15 t-tertiary linklike"
              onClick={() => detailsRef.current?.removeAttribute("open")}
            >
              Tutup
            </button>
          </div>
        </div>
      </details>

      {/* Preset periode */}
      <div className="seg">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`seg-btn${pkey === p.key ? " active" : ""}`}
            onClick={() => (p.key === "custom" ? nav({ p: "custom", from: dFrom, to: dTo }) : nav({ p: p.key }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Rentang custom */}
      {pkey === "custom" && (
        <div className="range-inputs">
          <input
            type="date"
            value={dFrom}
            max={today}
            onChange={(e) => setDFrom(e.target.value)}
            aria-label="Tanggal awal"
          />
          <span className="t-tertiary">–</span>
          <input
            type="date"
            value={dTo}
            max={today}
            onChange={(e) => setDTo(e.target.value)}
            aria-label="Tanggal akhir"
          />
          <button type="button" className="btn-navy" onClick={() => nav({ p: "custom", from: dFrom, to: dTo })}>
            Terapkan
          </button>
        </div>
      )}

      {/* Mode tampilan */}
      <div className="seg">
        {(
          [
            { m: "kumulatif" as const, label: "Kumulatif" },
            { m: "banding" as const, label: "Perbandingan" },
          ]
        ).map(({ m, label }) => (
          <button
            key={m}
            type="button"
            className={`seg-btn${mode === m ? " active" : ""}`}
            onClick={() => nav({ mode: m })}
            disabled={units.length === 1 && m === "banding"}
            title={units.length === 1 && m === "banding" ? "Butuh ≥ 2 unit dalam scope" : undefined}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
