"use client";

import { useState, useTransition } from "react";
import { rp } from "@/lib/format";
import { addManualEntry, voidManualEntry } from "@/lib/manual-entry-actions";
import type { ManualEntryRow, ManualSection } from "@/lib/queries";

/**
 * Form input manual (Pendapatan Lain / Pengeluaran) — no-print. Tulis via server
 * action (`app.manual_entry`), di-scope di server. Edit = batalkan (void) + tambah
 * baru. Keamanan scope ditegakkan di action; komponen ini hanya UI.
 */
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

  const add = (): void => {
    setErr(null);
    const amt = Number(amount.replace(/[^\d.-]/g, ""));
    start(async () => {
      const res = await addManualEntry({ code, date, section, keterangan: ket, amount: amt });
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
      await voidManualEntry({ code, date, id });
    });
  };

  return (
    <div className="manual-form mt6">
      <div className="fs15 w700 t-brand">{title}</div>
      {entries.length === 0 ? (
        <div className="fs15 t-tertiary mt2">Belum ada entri.</div>
      ) : (
        <ul className="manual-list mt2">
          {entries.map((e) => (
            <li key={e.id} className="manual-item">
              <span className="fs15 t-primary">{e.keterangan}</span>
              <span className="fs15 num">{rp(e.amount)}</span>
              <button
                type="button"
                disabled={pending}
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
        <button
          type="button"
          disabled={pending || !ket.trim() || !amount.trim()}
          onClick={add}
          className="manual-add-btn fs15 w600"
        >
          {pending ? "…" : "Tambah"}
        </button>
      </div>
      {err && <div className="fs15 t-danger mt2">{err}</div>}
    </div>
  );
}
