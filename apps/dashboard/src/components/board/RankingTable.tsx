"use client";

import Link from "next/link";
import { useState } from "react";

export interface RankProduct {
  name: string;
  volLabel: string;
  widthPct: number;
  fill: "pso" | "npso" | "npso2";
}

export interface RankNote {
  tone: "success" | "warning" | "danger" | "info";
  text: string;
}

export interface RankRow {
  rank: number;
  code: string;
  dotted: string;
  name: string;
  omzet: string;
  vol: string;
  gl: string;
  glAbnormal: boolean;
  rg: string;
  inputTone: "success" | "warning" | "danger";
  inputLabel: string;
  products: RankProduct[];
  sparkHeights: number[]; // 0–46 px, kiri=terlama
  notes: RankNote[];
  laporanHref: string;
}

/** Ranking unit — klik baris = expand inline; satu baris terbuka pada satu waktu. */
export function RankingTable({ rows }: { rows: RankRow[] }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="card tbl-card mt5">
      <div className="grid-head cols-rank">
        <span>#</span>
        <span>SPBU</span>
        <span className="right">Omset</span>
        <span className="right">Volume</span>
        <span className="right">Gain/Loss</span>
        <span className="right">NPSO (G)</span>
        <span>Input</span>
        <span />
      </div>
      {rows.map((u) => {
        const expanded = open === u.code;
        return (
          <div key={u.code}>
            <div
              className={`grid-row cols-rank clickable${expanded ? " expanded" : ""}`}
              onClick={() => setOpen(expanded ? null : u.code)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") setOpen(expanded ? null : u.code);
                if (e.key === "Escape") setOpen(null);
              }}
            >
              <span className="fs16 t-tertiary num">{u.rank}</span>
              <span className="rank-name">
                <span className="text-caption w600 t-primary">{u.name}</span>
                <span className="fs15 t-tertiary mono">{u.dotted}</span>
              </span>
              <span className="right w600 num nowrap rank-omzet">{u.omzet}</span>
              <span className="right fs16 t-secondary num">{u.vol}</span>
              <span className={`right fs16 w600 num ${u.glAbnormal ? "t-danger" : "t-secondary"}`}>
                {u.gl}
              </span>
              <span className="right fs16 t-secondary num">{u.rg}</span>
              <span className="rank-input">
                <span className={`dot ${u.inputTone}`} />
                <span className="fs15 t-secondary">{u.inputLabel}</span>
              </span>
              <span className="t-tertiary fs15 rank-chev">{expanded ? "▾" : "›"}</span>
            </div>
            {expanded && (
              <div className="rank-exp">
                <div>
                  <div className="exp-h">Volume per produk</div>
                  <div className="exp-rows mt3">
                    {u.products.map((p) => (
                      <div key={p.name} className="prod-row">
                        <span className="fs16 t-secondary">{p.name}</span>
                        <div className="prod-bar">
                          <div className={`prod-fill ${p.fill}`} style={{ width: `${Math.round(p.widthPct)}%` }} />
                        </div>
                        <span className="fs15 t-tertiary right num">{p.volLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="exp-h">Omset 14 hari</div>
                  <div className="spark-bars mt3">
                    {u.sparkHeights.map((h, i) => (
                      <div key={i} className="spark-bar" style={{ height: Math.round(h) }} />
                    ))}
                  </div>
                  <div className="fs15 t-tertiary mt2">kanan = tanggal bisnis terkini</div>
                </div>
                <div>
                  <div className="exp-h">Catatan</div>
                  <div className="exp-rows mt3">
                    {u.notes.map((n, i) => (
                      <div key={i} className="exp-note">
                        <span className={`dot ${n.tone}`} />
                        <span className="fs16 t-secondary">{n.text}</span>
                      </div>
                    ))}
                    <Link href={u.laporanHref} className="fs16 w600 t-accent mt1">
                      Buka laporan operasional harian →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
