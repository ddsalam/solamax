"use client";

import { useState, useTransition } from "react";
import { fmtL, idn } from "@/lib/format";
import type { UsulanStatus } from "@/lib/queries";
import { saveUsulanSo } from "@/lib/usulan-actions";

/**
 * Form Usulan Penebusan SO (no-print input pengawas). Tiga kolom kanan (Penerimaan
 * Hari / Plan Permintaan Besok / Usulan Penebusan) = input manual; tiga kolom kiri
 * (Sisa Stock awal / Ketahanan / Sisa DO awal) READ-ONLY carry-forward (D−1),
 * dihitung di server. Simpan/Ajukan via server action ber-scope (void+insert).
 * Status draft→diajukan; setelah diajukan tetap bisa diedit (Simpan pertahankan
 * status). Keamanan scope ditegakkan di action; komponen ini hanya UI.
 */
export interface UsulanRowInput {
  key: string;
  label: string;
  sisaStock: number | null;
  /** Stock Fisik penutup D−1 belum final (opname-penutup belum ada) → tampil "—". */
  sisaStockProvisional: boolean;
  ketahanan: number | null;
  ketahananLevel: "danger" | "warning" | "ok" | "unknown";
  sisaDo: number;
  penerimaanHari: number;
  permintaanBesok: number;
  usulanPenebusan: number;
}

type Field = "penerimaanHari" | "permintaanBesok" | "usulanPenebusan";

export function UsulanForm({
  code,
  date,
  rows,
  status: initialStatus,
}: {
  code: string;
  date: string;
  rows: UsulanRowInput[];
  status: UsulanStatus;
}) {
  // State angka manual per produk (string utk edit; digit-only → liter bulat).
  const init = (): Record<string, Record<Field, string>> => {
    const m: Record<string, Record<Field, string>> = {};
    for (const r of rows) {
      m[r.key] = {
        penerimaanHari: r.penerimaanHari ? String(r.penerimaanHari) : "",
        permintaanBesok: r.permintaanBesok ? String(r.permintaanBesok) : "",
        usulanPenebusan: r.usulanPenebusan ? String(r.usulanPenebusan) : "",
      };
    }
    return m;
  };
  const [vals, setVals] = useState(init);
  const [status, setStatus] = useState<UsulanStatus>(initialStatus);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (key: string, field: Field, raw: string): void => {
    const digits = raw.replace(/\D/g, "");
    setVals((p) => ({ ...p, [key]: { ...p[key]!, [field]: digits } }));
    setMsg(null);
  };
  const n = (key: string, field: Field): number => Number(vals[key]?.[field] || 0);

  const tot = rows.reduce(
    (a, r) => ({
      sisaStock: a.sisaStock + (r.sisaStock ?? 0),
      sisaDo: a.sisaDo + r.sisaDo,
      penerimaanHari: a.penerimaanHari + n(r.key, "penerimaanHari"),
      permintaanBesok: a.permintaanBesok + n(r.key, "permintaanBesok"),
      usulanPenebusan: a.usulanPenebusan + n(r.key, "usulanPenebusan"),
    }),
    { sisaStock: 0, sisaDo: 0, penerimaanHari: 0, permintaanBesok: 0, usulanPenebusan: 0 },
  );

  const save = (nextStatus: UsulanStatus): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await saveUsulanSo({
        code,
        date,
        status: nextStatus,
        rows: rows.map((r) => ({
          productKey: r.key,
          penerimaanHari: n(r.key, "penerimaanHari"),
          permintaanBesok: n(r.key, "permintaanBesok"),
          usulanPenebusan: n(r.key, "usulanPenebusan"),
        })),
      });
      if (!res.ok) setErr(res.error);
      else {
        setStatus(nextStatus);
        setMsg(nextStatus === "diajukan" ? "Tersimpan & diajukan ke Keuangan." : "Tersimpan (draft).");
      }
    });
  };

  return (
    <div className="card tbl-card mt4">
      <div className="grid-head cols-usulan">
        <span>Produk</span>
        <span className="right">Sisa Stock awal</span>
        <span className="right">Ketahanan</span>
        <span className="right">Sisa DO awal</span>
        <span className="right">Penerimaan Hari</span>
        <span className="right">Plan Permintaan Besok</span>
        <span className="right">Usulan Penebusan</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid-row cols-usulan">
          <span className="text-caption w600">{r.label}</span>
          <span className="right fs16 num t-secondary">
            {r.sisaStock !== null ? (
              fmtL(r.sisaStock)
            ) : (
              <>
                —{" "}
                <span className="usulan-prov" title="Stock Fisik penutup D−1 belum final">
                  sementara
                </span>
              </>
            )}
          </span>
          <span
            className={`right fs16 num ${
              r.ketahananLevel === "danger"
                ? "t-danger w700"
                : r.ketahananLevel === "warning"
                  ? "t-warning w700"
                  : r.ketahanan !== null
                    ? "t-primary"
                    : "t-tertiary"
            }`}
          >
            {r.ketahanan !== null ? `${idn(r.ketahanan, 1)} hari` : "—"}
          </span>
          <span className="right fs16 num t-secondary">{fmtL(r.sisaDo)}</span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="numeric"
              value={vals[r.key]?.penerimaanHari ?? ""}
              onChange={(e) => set(r.key, "penerimaanHari", e.target.value)}
              aria-label={`Penerimaan Hari ${r.label}`}
            />
          </span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="numeric"
              value={vals[r.key]?.permintaanBesok ?? ""}
              onChange={(e) => set(r.key, "permintaanBesok", e.target.value)}
              aria-label={`Plan Permintaan Besok ${r.label}`}
            />
          </span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="numeric"
              value={vals[r.key]?.usulanPenebusan ?? ""}
              onChange={(e) => set(r.key, "usulanPenebusan", e.target.value)}
              aria-label={`Usulan Penebusan ${r.label}`}
            />
          </span>
        </div>
      ))}
      <div className="grid-total cols-usulan">
        <span className="text-caption w700">TOTAL</span>
        <span className="right w700 num lap-totnum">
          {fmtL(tot.sisaStock)}
          {rows.some((r) => r.sisaStockProvisional) && (
            <>
              {" "}
              <span className="usulan-prov" title="Sebagian produk belum final (sementara)">
                sebagian
              </span>
            </>
          )}
        </span>
        <span className="right num t-tertiary">—</span>
        <span className="right w700 num lap-totnum">{fmtL(tot.sisaDo)}</span>
        <span className="right w700 num lap-totnum">{fmtL(tot.penerimaanHari)}</span>
        <span className="right w700 num lap-totnum">{fmtL(tot.permintaanBesok)}</span>
        <span className="right w700 num lap-totnum">{fmtL(tot.usulanPenebusan)}</span>
      </div>

      <div className="usulan-actions no-print">
        <span className={`status-pill ${status === "diajukan" ? "diajukan" : "draft"}`}>
          {status === "diajukan" ? "Diajukan ke Keuangan" : "Draft"}
        </span>
        <div className="usulan-actions-btns">
          {msg && <span className="fs15 w600 t-success">{msg}</span>}
          {err && <span className="fs15 t-danger">{err}</span>}
          <button type="button" className="btn-tint sm" disabled={pending} onClick={() => save(status)}>
            {pending ? "…" : "Simpan"}
          </button>
          <button
            type="button"
            className="btn-navy"
            disabled={pending}
            onClick={() => save("diajukan")}
          >
            {pending ? "…" : "Ajukan ke Keuangan"}
          </button>
        </div>
      </div>
    </div>
  );
}
