"use client";

/**
 * Baris filter board direksi — SEMUA state di URL searchParams (shareable):
 * ?units=…&p=…&from=…&to=…&mode=… . Komponen ini hanya MEMBANGUN URL; otorisasi
 * unit terjadi di server (parseBoardParams ∩ getDataScope) — mencentang unit di
 * luar scope lewat URL tidak berefek (intersect-fallback).
 */
import Link from "next/link";
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
  const periodeRef = useRef<HTMLDetailsElement>(null);
  const periodeSummaryRef = useRef<HTMLElement>(null);
  const periodeOptRefs = useRef<Array<HTMLAnchorElement | null>>([]);
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

  /** URL sebuah preset — dibangun lewat `boardParamsToQuery` yang SAMA dengan
   *  `nav()`, jadi semantik `?p=` tak bergeser sedikit pun. */
  const presetHref = (p: string) =>
    `/board${boardParamsToQuery({
      unitCodes: selected,
      allUnits: selected.length === units.length,
      p,
      from: dFrom,
      to: dTo,
      mode,
    })}`;

  /**
   * Keyboard picker periode — SENGAJA cermin UnitDateFilters, bukan diekstrak.
   * Mengekstrak berarti menyentuh komponen yang sudah live & terverifikasi di
   * dalam PR yang seharusnya satu perubahan kecil. Kalau pola ini muncul di
   * call site KETIGA, ekstrak — jangan duplikasi lagi.
   *
   * Panah/Tab hanya MEMINDAH FOKUS (nol navigasi, nol entri history); hanya
   * aktivasi eksplisit (klik/Enter pada <Link>) yang menerapkan. Esc menutup &
   * mengembalikan fokus ke pemicu. Tak ada handler blur yang menerapkan diam-diam.
   */
  const tutupPeriode = (refocus: boolean) => {
    const d = periodeRef.current;
    if (!d?.open) return;
    d.open = false;
    if (refocus) periodeSummaryRef.current?.focus();
  };
  const fokusOpsi = (i: number) => {
    const list = periodeOptRefs.current.filter((el): el is HTMLAnchorElement => el !== null);
    if (list.length === 0) return;
    list[((i % list.length) + list.length) % list.length]?.focus();
  };
  const onPeriodeKeyDown = (e: React.KeyboardEvent<HTMLDetailsElement>) => {
    const d = periodeRef.current;
    if (!d) return;
    if (e.key === "Escape") {
      if (!d.open) return;
      e.preventDefault();
      tutupPeriode(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault(); // jangan menggulir halaman
    if (!d.open) d.open = true;
    const list = periodeOptRefs.current.filter((el): el is HTMLAnchorElement => el !== null);
    const cur = list.indexOf(document.activeElement as HTMLAnchorElement);
    const aktif = Math.max(PRESETS.findIndex((p) => p.key === pkey), 0);
    if (cur === -1) fokusOpsi(e.key === "ArrowDown" ? aktif : list.length - 1);
    else fokusOpsi(cur + (e.key === "ArrowDown" ? 1 : -1));
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
    <>
    {/*
      DUA BARIS, sengaja.

      Baris 1 (sticky) = yang diraih BERULANG saat membaca board: unit & periode.
      Baris 2 (ikut tergulung) = yang di-set SEKALI di awal: mode tampilan
      (keputusan owner) dan rentang custom.

      Rentang custom ditaruh di baris 2 — bukan baris 1 — karena ia muncul
      BERSYARAT (`pkey === "custom"`). Di baris sticky ia akan membuat tinggi
      bilah berubah-ubah tiap kali preset diganti, sehingga konten melompat;
      di baris 2 tinggi bilah sticky tetap konstan di semua preset. Ia tetap
      terlihat saat muncul karena mengganti preset = navigasi (router.push) dan
      Next mengembalikan scroll ke atas — diverifikasi, bukan diasumsikan.
    */}
    <div className="board-filters filters-sticky no-print" role="group" aria-label="Filter unit & periode">
      {/* Checklist unit multi-pilih */}
      <details
        ref={detailsRef}
        className="unit-picker"
        onToggle={() => { if (detailsRef.current?.open) tutupPeriode(false); }}
      >
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

      {/*
        Preset periode = DROPDOWN, bukan lima tombol sebaris.

        Alasannya terukur, bukan selera: `.seg` lima preset selebar 460px membuat
        bilah sticky MEMBUNGKUS jadi dua baris di bawah 971–976px (65 → 117,8px),
        yaitu +59,8px chrome permanen — memburuk, bukan membaik. Satu pemicu
        (~180px) membuatnya KONSTAN 57,8px dari 1436 sampai 426px.

        TANPA BREAKPOINT — sengaja. Karena tingginya konstan di seluruh rentang,
        tak ada ambang yang perlu dipasang, diingat, atau salah dikalibrasi saat
        isi bilah berubah nanti. Rencana awal "dropdown di bawah ~1000px"
        DIBATALKAN oleh pengukuran itu sendiri.

        Preset ini di-set sekali lalu dibaca — bukan `‹ ›` yang diraih berulang.
        Karena itu menguncupkannya TIDAK melanggar prinsip "yang menempel adalah
        yang sering dipakai"; menguncupkan stepper tanggal akan, dan itu sudah
        diukur lalu DITOLAK (lihat catatan Fase 0.5).

        Tiap opsi <Link> ber-href nyata dari `boardParamsToQuery` yang SAMA
        dengan `nav()` → semantik `?p=` identik, dan ⌘/ctrl-klik membuka periode
        lain di tab baru.
      */}
      <details
        ref={periodeRef}
        className="unit-picker"
        onKeyDown={onPeriodeKeyDown}
        onToggle={() => { if (periodeRef.current?.open) detailsRef.current?.removeAttribute("open"); }}
      >
        <summary ref={periodeSummaryRef} className="btn-outline unit-picker-btn">
          <span className="fs15 t-tertiary">Periode</span>
          <span className="fs16 w600">
            {PRESETS.find((p) => p.key === pkey)?.label ?? pkey}
          </span>
          <span className="t-tertiary">▾</span>
        </summary>
        <div className="unit-picker-panel card" role="group" aria-label="Pilih periode">
          {PRESETS.map((p, i) => (
            <Link
              key={p.key}
              ref={(el) => {
                periodeOptRefs.current[i] = el;
              }}
              href={presetHref(p.key)}
              className="unit-picker-row unit-picker-opt"
              aria-current={pkey === p.key ? "true" : undefined}
              onClick={() => tutupPeriode(false)}
            >
              <span className="unit-picker-mark" aria-hidden="true">
                {pkey === p.key ? "\u2713" : ""}
              </span>
              <span className="fs16 t-primary">{p.label}</span>
            </Link>
          ))}
        </div>
      </details>

    </div>

    <div className="board-filters filters-flow no-print" role="group" aria-label="Rentang custom & mode tampilan">
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
    </>
  );
}
