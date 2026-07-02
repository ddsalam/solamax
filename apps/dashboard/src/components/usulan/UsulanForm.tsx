"use client";

import { useOptimistic, useState, useTransition } from "react";
import { LoadingButton } from "@/components/loading/LoadingButton";
import { StateView } from "@/components/loading/StateView";
import { fmtKL, idn } from "@/lib/format";
import type { UsulanStatus } from "@/lib/queries";
import { saveUsulanSo } from "@/lib/usulan-actions";
import type { UsulanRow } from "@/lib/usulan-model";

/**
 * Form Usulan Penebusan SO (no-print input pengawas). Tiga kolom kanan (Penerimaan
 * Hari / Plan Permintaan Besok / Usulan Penebusan) = input manual; tiga kolom kiri
 * (Sisa Stock awal / Ketahanan / Sisa DO awal) READ-ONLY carry-forward (D−1),
 * dihitung di server. Simpan/Ajukan via server action ber-scope (void+insert).
 * Status draft→diajukan; setelah diajukan tetap bisa diedit (Simpan pertahankan
 * status). Keamanan scope ditegakkan di action; komponen ini hanya UI.
 */
type Field = "penerimaanHari" | "permintaanBesok" | "usulanPenebusan";

// --- Seam KiloLiter (KL) ↔ Liter -------------------------------------------
// Penyimpanan tetap Liter (app.usulan_so); konversi HANYA di batas UI.
// 1 KL = 1000 L. Input & tampilan 3 desimal; KL→Liter selalu integer via
// round(kl × 1000) sehingga round-trip lossless (storage whole-liter).

/** String KL yg diketik user (koma sbg pemisah) → Liter integer. "" → 0. */
const parseKlToLiter = (s: string): number => {
  const kl = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(kl) ? Math.round(kl * 1000) : 0;
};

/** Liter tersimpan → string KL editable (koma, ≤3 desimal, tanpa trailing 0). */
const literToKlStr = (l: number): string =>
  l ? String(Number((l / 1000).toFixed(3))).replace(".", ",") : "";

/** Sanitizer input KL: digit + satu pemisah desimal (→koma) + maks 3 desimal. */
const sanitizeKl = (raw: string): string => {
  let s = raw.replace(/[^\d.,]/g, "").replace(/[.,]/g, ",");
  const i = s.indexOf(",");
  if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/,/g, "").slice(0, 3);
  return s;
};

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
  // State angka manual per produk (string KL utk edit; ×1000 → liter bulat saat simpan).
  const init = (): Record<string, Record<Field, string>> => {
    const m: Record<string, Record<Field, string>> = {};
    for (const r of rows) {
      m[r.key] = {
        penerimaanHari: literToKlStr(r.penerimaanHari),
        permintaanBesok: literToKlStr(r.permintaanBesok),
        usulanPenebusan: literToKlStr(r.usulanPenebusan),
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
    const kl = sanitizeKl(raw);
    setVals((p) => ({ ...p, [key]: { ...p[key]!, [field]: kl } }));
    setMsg(null);
  };
  // KL string → Liter integer (dipakai TOTAL & save; read-only TOTAL tetap Liter murni).
  const n = (key: string, field: Field): number => parseKlToLiter(vals[key]?.[field] ?? "");

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
    <div className="card tbl-card mt4">
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
          <span className="right fs16 num t-secondary">{fmtKL(r.sisaDo, 3)}</span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="decimal"
              value={vals[r.key]?.penerimaanHari ?? ""}
              onChange={(e) => set(r.key, "penerimaanHari", e.target.value)}
              aria-label={`Penerimaan Hari ${r.label}`}
            />
          </span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="decimal"
              value={vals[r.key]?.permintaanBesok ?? ""}
              onChange={(e) => set(r.key, "permintaanBesok", e.target.value)}
              aria-label={`Plan Permintaan Besok ${r.label}`}
            />
          </span>
          <span className="usulan-incell">
            <input
              className="usulan-input"
              inputMode="decimal"
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
        <span className="right w700 num lap-totnum">{fmtKL(tot.sisaDo, 3)}</span>
        <span className="right w700 num lap-totnum">{fmtKL(tot.penerimaanHari, 3)}</span>
        <span className="right w700 num lap-totnum">{fmtKL(tot.permintaanBesok, 3)}</span>
        <span className="right w700 num lap-totnum">{fmtKL(tot.usulanPenebusan, 3)}</span>
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
