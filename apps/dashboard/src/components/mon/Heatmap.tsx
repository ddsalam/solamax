"use client";

import { useState } from "react";

export interface HmModule {
  name: string;
  tone: "success" | "warning" | "danger" | "pending";
  note: string;
}

export interface HmCell {
  d: string; // YYYY-MM-DD
  tone: "success" | "warning" | "danger";
  isToday: boolean;
  /** Belum jatuh tempo (akhir H+1) atau tak bisa dinilai — jangan dihukum. */
  pending: boolean;
  /** Pending TAPI pengawas sudah mengisi — sinyal real-time "siapa sudah". */
  pendingFilled: boolean;
  modules: HmModule[];
}

export interface HmRow {
  code: string;
  name: string;
  cells: HmCell[]; // kiri = terlama
}

/** 4c · Heatmap ketaatan unit × hari; klik sel → panel modul yang bolong. */
export function Heatmap({ rows, dayLabels }: { rows: HmRow[]; dayLabels: string[] }) {
  const [sel, setSel] = useState<{ row: HmRow; cell: HmCell } | null>(null);

  return (
    <div>
      <div className="card card-pad-lg hm-scroll mt4">
        <div className="hm-grid">
          <span />
          {dayLabels.map((d, i) => (
            <span key={i} className="hm-daylabel">
              {d}
            </span>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.code} className="hm-grid mt1">
            <span className="fs15 w600 t-secondary nowrap hm-rowname">{r.name}</span>
            {r.cells.map((c) => (
              <button
                key={c.d}
                type="button"
                aria-label={`${r.name} ${c.d}`}
                className={`hm-cell ${c.pending ? `pending${c.pendingFilled ? " filled" : ""}` : c.tone}${c.isToday ? " today" : ""}`}
                onClick={() => setSel({ row: r, cell: c })}
              />
            ))}
          </div>
        ))}
      </div>

      {sel && (
        <div className="card card-pad-lg mt4">
          <div className="section-h">
            <span className="text-h6 t-brand">
              {sel.row.name} · {sel.cell.d}
            </span>
            <span className="fs15 t-tertiary">status per modul</span>
            <button type="button" className="btn-outline hm-close" onClick={() => setSel(null)}>
              Tutup
            </button>
          </div>
          <div className="hm-mods mt4">
            {sel.cell.modules.map((m) => (
              <div key={m.name} className={`hm-mod ${m.tone}`}>
                <span className={`dot ${m.tone}`} />
                <span
                  className={`fs15 w600 t-${m.tone === "success" ? "success" : m.tone === "pending" ? "tertiary" : m.tone}`}
                >
                  {m.name}
                </span>
                <span className="hm-modnote fs15 t-tertiary">{m.note}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
