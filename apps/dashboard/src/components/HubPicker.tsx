"use client";

import { useRouter, useSearchParams } from "next/navigation";

export interface UnitOpt {
  code: string;
  label: string;
}

/** Pemilih unit + tanggal bisnis (konteks global hub → terbawa via URL). */
export function HubPicker({ units, date }: { units: UnitOpt[]; date: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`/?${next.toString()}`);
  };

  return (
    <>
      <select
        className="select"
        value={params.get("unit") ?? units[0]?.code ?? ""}
        onChange={(e) => set("unit", e.target.value)}
        aria-label="Pilih unit"
      >
        {units.map((u) => (
          <option key={u.code} value={u.code}>
            {u.label}
          </option>
        ))}
      </select>
      <input
        className="date-input"
        type="date"
        value={params.get("date") ?? date}
        onChange={(e) => set("date", e.target.value)}
        aria-label="Tanggal bisnis"
      />
      <span className="fs15 t-tertiary">tanggal bisnis</span>
    </>
  );
}
