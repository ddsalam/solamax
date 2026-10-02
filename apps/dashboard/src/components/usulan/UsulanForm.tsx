"use client";

import { useOptimistic, useState, useTransition } from "react";
import { LoadingButton } from "@/components/loading/LoadingButton";
import { StateView } from "@/components/loading/StateView";
import { fmtKL, idn } from "@/lib/format";
import type { UsulanStatus } from "@/lib/queries";
import { saveUsulanSo } from "@/lib/usulan-actions";
import type { UsulanRow } from "@/lib/usulan-model";
import {
  editUsulanInputValue, sumUsulanQuantities, usulanInputValue, type UsulanInputValue,
} from "@/lib/usulan-quantities";
import { formatUsulanKl } from "./format";

/**
 * Form Usulan Penebusan SO (no-print input pengawas). Tiga kolom kanan (Penerimaan
 * Hari / Plan Permintaan Besok / Usulan Penebusan) = input manual; tiga kolom kiri
 * (Sisa Stock awal / Ketahanan / Sisa DO awal) READ-ONLY carry-forward (D−1),
 * dihitung di server. Simpan/Ajukan via server action ber-scope (void+insert).
 * Status draft→diajukan; setelah diajukan tetap bisa diedit (Simpan pertahankan
 * status). Keamanan scope ditegakkan di action; komponen ini hanya UI.
 */
type Field = "penerimaanHari" | "permintaanBesok" | "usulanPenebusan";

export function UsulanForm({
  code,
  date,
  rows,
  status: initialStatus,
}: {
  code: string;
  date: string;
  rows: UsulanRow[];
  status: UsulanStatus;
}) {
  // Teks KL + nilai liter asli: membuka/blur/simpan tanpa edit tidak membulatkan data DB.
  const init = (): Record<string, Record<Field, UsulanInputValue>> => {
    const m: Record<string, Record<Field, UsulanInputValue>> = {};
    for (const r of rows) {
      m[r.key] = {
        penerimaanHari: usulanInputValue(r.penerimaanHari),
        permintaanBesok: usulanInputValue(r.permintaanBesok),
        usulanPenebusan: usulanInputValue(r.usulanPenebusan),
      };
    }
    return m;
  };
  const [vals, setVals] = useState(init);
  const [status, setStatus] = useState<UsulanStatus>(initialStatus);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Optimistic (rule 10, presentasi saja — kontrak action/scope TAK berubah):
  // pill status melompat ke target saat menyimpan; React auto-revert ke `status`
  // bila transisi selesai dgagal. Sukses → setStatus mempertahankannya.
  const [optStatus, setOptStatus] = useOptimistic<UsulanStatus, UsulanStatus>(
    status,
    (_, next) => next,
  );

  const set = (key: string, field: Field, raw: string): void => {
    const value = editUsulanInputValue(raw);
    setVals((p) => ({ ...p, [key]: { ...p[key]!, [field]: value } }));
    setMsg(null);
  };
  // TOTAL dan save memakai nilai numerik, bukan teks presentasi yang dibulatkan.
  const n = (key: string, field: Field): number | null => vals[key]?.[field]?.liters ?? null;

  // Incomplete decimal punctuation is not a numeric contributor while editing;
  // the server still rejects it on save instead of silently storing a blank.
  const total = (field: Field) => sumUsulanQuantities(rows.map((r) => {
    const value = n(r.key, field);
    return value !== null && !Number.isFinite(value) ? null : value;
  }));
  const tot = {
    sisaStock: rows.reduce((sum, r) => sum + (r.sisaStock ?? 0), 0),
    sisaDo: sumUsulanQuantities(rows.map((r) => r.sisaDo)),
    penerimaanHari: total("penerimaanHari"),
    permintaanBesok: total("permintaanBesok"),
    usulanPenebusan: total("usulanPenebusan"),
  };
  const compact = (key: string, field: Field): void => {
    const value = n(key, field);
    if (value === null || Number.isFinite(value)) {
      setVals((p) => ({ ...p, [key]: { ...p[key]!, [field]: usulanInputValue(value) } }));
    }
  };

  const save = (nextStatus: UsulanStatus): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      setOptStatus(nextStatus);
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
    <div className="card tbl-card mt4 tbl-scroll">
      <div className="grid-head cols-usulan">
        <span>Produk</span>
        <span className="right">Sisa Stock awal (KL)</span>
        <span className="right">Ketahanan</span>
        <span className="right">Sisa DO awal (KL)</span>
        <span className="right">Penerimaan Hari (KL)</span>
        <span className="right">Plan Permintaan Besok (KL)</span>
        <span className="right">Usulan Penebusan (KL)</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid-row cols-usulan">
          <span className="text-caption w600">{r.label}</span>
          <span className="right fs16 num t-secondary">
            {r.sisaStock !== null ? (
              fmtKL(r.sisaStock, 3)
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
          <span className="right fs16 num t-secondary">{formatUsulanKl(r.sisaDo)}</span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="decimal"
              value={vals[r.key]?.penerimaanHari?.text ?? ""}
              onChange={(e) => set(r.key, "penerimaanHari", e.target.value)}
              onBlur={() => compact(r.key, "penerimaanHari")}
              aria-label={`Penerimaan Hari ${r.label}`}
            />
          </span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="decimal"
              value={vals[r.key]?.permintaanBesok?.text ?? ""}
              onChange={(e) => set(r.key, "permintaanBesok", e.target.value)}
              onBlur={() => compact(r.key, "permintaanBesok")}
              aria-label={`Plan Permintaan Besok ${r.label}`}
            />
          </span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="decimal"
              value={vals[r.key]?.usulanPenebusan?.text ?? ""}
              onChange={(e) => set(r.key, "usulanPenebusan", e.target.value)}
              onBlur={() => compact(r.key, "usulanPenebusan")}
              aria-label={`Usulan Penebusan ${r.label}`}
            />
          </span>
        </div>
      ))}
      <div className="grid-total cols-usulan">
        <span className="text-caption w700">TOTAL</span>
        <span className="right w700 num lap-totnum">
          {fmtKL(tot.sisaStock, 3)}
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
        <span className="right w700 num lap-totnum">{formatUsulanKl(tot.sisaDo)}</span>
        <span className="right w700 num lap-totnum">{formatUsulanKl(tot.penerimaanHari)}</span>
        <span className="right w700 num lap-totnum">{formatUsulanKl(tot.permintaanBesok)}</span>
        <span className="right w700 num lap-totnum">{formatUsulanKl(tot.usulanPenebusan)}</span>
      </div>

      <div className="usulan-actions no-print">
        <span className={`status-pill ${optStatus === "diajukan" ? "diajukan" : "draft"}`}>
          {optStatus === "diajukan" ? "Diajukan ke Keuangan" : "Draft"}
        </span>
        <div className="usulan-actions-btns">
          {msg && !err && <StateView state="success" successText={msg} />}
          {err && <StateView state="error" inline error={err} />}
          <LoadingButton
            pending={pending}
            className="btn-tint sm"
            onClick={() => save(status)}
            pendingLabel="Menyimpan…"
          >
            Simpan
          </LoadingButton>
          <LoadingButton
            pending={pending}
            className="btn-navy"
            onClick={() => save("diajukan")}
            pendingLabel="Menyimpan…"
          >
            Ajukan ke Keuangan
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
