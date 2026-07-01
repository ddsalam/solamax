"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { LoadingButton } from "@/components/loading/LoadingButton";
import { StateView } from "@/components/loading/StateView";
import { rp } from "@/lib/format";
import { addManualEntry, voidManualEntry } from "@/lib/manual-entry-actions";
import type { ManualEntryRow, ManualSection } from "@/lib/queries";

/**
 * Form input manual (Pendapatan Lain / Pengeluaran / Setoran Tunai) — no-print.
 * Tulis via server action (`app.manual_entry`), di-scope di server. Edit =
 * batalkan (void) + tambah baru. Keamanan scope ditegakkan di action; komponen
 * ini hanya UI.
 *
 * Optimistic (rule 10, PRESENTASI saja — kontrak action/revalidate/void-only &
 * ScopedUnitId TAK berubah): TAMBAH → baris provisional kelabu (aria-busy)
 * langsung tampil; VOID → baris langsung disembunyikan. React auto-revert state
 * optimistic saat transisi selesai; pada {ok:false} baris provisional hilang /
 * baris ter-void muncul lagi + pesan error (role=alert).
 */
type OptRow = ManualEntryRow & { _pending?: boolean };
type OptAction = { kind: "add"; row: OptRow } | { kind: "void"; id: string };

export function ManualEntryForm({
  code,
  date,
  section,
  title,
  entries,
}: {
  code: string;
  date: string;
  section: ManualSection;
  title: string;
  entries: ManualEntryRow[];
}) {
  const [ket, setKet] = useState("");
  const [amount, setAmount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  const [optEntries, applyOpt] = useOptimistic<OptRow[], OptAction>(entries, (state, action) =>
    action.kind === "add"
      ? [...state, action.row]
      : state.filter((e) => e.id !== action.id),
  );

  const add = (): void => {
    setErr(null);
    const amt = Number(amount.replace(/[^\d.-]/g, ""));
    const ketTrim = ket.trim();
    start(async () => {
      applyOpt({
        kind: "add",
        row: { id: `opt-${seq.current++}`, keterangan: ketTrim, amount: amt, urut: 9_999, _pending: true },
      });
      const res = await addManualEntry({ code, date, section, keterangan: ketTrim, amount: amt });
      if (!res.ok) setErr(res.error);
      else {
        setKet("");
        setAmount("");
      }
    });
  };

  const remove = (id: string): void => {
    setErr(null);
    start(async () => {
      applyOpt({ kind: "void", id });
      const res = await voidManualEntry({ code, date, id });
      if (!res.ok) setErr(res.error);
    });
  };

  return (
    <div className="manual-form mt6">
      <div className="fs15 w700 t-brand">{title}</div>
      {optEntries.length === 0 ? (
        <div className="fs15 t-tertiary mt2">Belum ada entri.</div>
      ) : (
        <ul className="manual-list mt2">
          {optEntries.map((e) => (
            <li key={e.id} className={`manual-item${e._pending ? " pending" : ""}`} aria-busy={e._pending}>
              <span className="fs15 t-primary">{e.keterangan}</span>
              <span className="fs15 num">{rp(e.amount)}</span>
              <button
                type="button"
                disabled={pending || e._pending}
                onClick={() => remove(e.id)}
                className="manual-void fs15"
              >
                Batalkan
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="manual-add mt2">
        <input
          value={ket}
          onChange={(e) => setKet(e.target.value)}
          placeholder="Keterangan"
          className="manual-input"
          aria-label={`Keterangan ${title}`}
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Jumlah (Rp)"
          inputMode="numeric"
          className="manual-input manual-amount"
          aria-label={`Jumlah ${title}`}
        />
        <LoadingButton
          pending={pending}
          disabled={!ket.trim() || !amount.trim()}
          onClick={add}
          className="manual-add-btn fs15 w600"
          pendingLabel="Menambah…"
        >
          Tambah
        </LoadingButton>
      </div>
      {err && (
        <div className="mt2">
          <StateView state="error" inline error={err} />
        </div>
      )}
    </div>
  );
}
