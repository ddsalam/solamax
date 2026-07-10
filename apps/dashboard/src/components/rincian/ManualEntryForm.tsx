"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { LoadingButton } from "@/components/loading/LoadingButton";
import { StateView } from "@/components/loading/StateView";
import { rp } from "@/lib/format";
import { addManualEntry, voidManualEntry } from "@/lib/manual-entry-actions";
import type { ManualEntryRow, ManualSection } from "@/lib/queries";

/**
 * Input manual Rincian (Pendapatan Lain / Pengeluaran / Setoran Tunai) — panel
 * pengawas, no-print. Tulis via server action (`app.manual_entry`), di-scope di
 * server; komponen ini hanya UI. "Batalkan" = void (UPDATE void=true, DELETE
 * di-REVOKE — migrasi 0007), maka label tetap "Batalkan".
 *
 * Struktur: `ManualEntryForm` (container stateful: optimistic add/void, fokus,
 * transisi) membungkus `ManualSectionView` (murni & terkontrol — bisa di-render
 * statis di test tanpa hook canary Next). Helper validasi/parse diekspor untuk
 * unit test.
 *
 * Optimistic (rule 10, PRESENTASI saja — kontrak action/revalidate/void-only &
 * ScopedUnitId TAK berubah): TAMBAH → baris provisional kelabu (aria-busy)
 * langsung tampil; VOID → baris langsung disembunyikan. React auto-revert state
 * optimistic saat transisi selesai; pada {ok:false} baris provisional hilang /
 * baris ter-void muncul lagi + pesan error (role=alert), isian dipertahankan.
 */

// --- Helper murni (diekspor untuk test) ------------------------------------

/** Batas atas nominal wajar (guard salah ketik, jauh di bawah overflow numeric). */
export const AMOUNT_MAX = 999_999_999_999;

/** Sanitasi input jumlah: digit saja, tanpa nol di depan. */
export const sanitizeAmount = (raw: string): string =>
  raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

/** Digit tersanitasi → number (string kosong → 0). */
export const parseAmount = (digits: string): number => (digits ? Number(digits) : 0);

/** Validasi sebelum submit; null = valid, selain itu pesan utk pengguna. */
export function validateEntry(ket: string, digits: string): string | null {
  if (!ket.trim()) return "Keterangan wajib diisi.";
  const n = parseAmount(digits);
  if (!digits || !Number.isFinite(n) || n <= 0) return "Jumlah harus angka lebih dari 0.";
  if (n > AMOUNT_MAX) return "Jumlah terlalu besar.";
  return null;
}

// --- Blok presentasi bersama ------------------------------------------------

/** Badge sumber "Manual" — layar saja (no-print) sesuai keputusan review. */
export function ManualSourceBadge() {
  return <span className="manual-badge no-print">Manual</span>;
}

/** Wrapper panel input manual (no-print) + caption; dipakai page Rincian. */
export function ManualPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="no-print manual-panel mt12">
      <div className="fs15 w700 t-tertiary">Input manual (pengawas) · tidak ikut cetak</div>
      {children}
    </div>
  );
}

/** Status rekonsiliasi I-vs-H (string SIAP-TAMPIL dari model.summary — tanpa
 *  hitung ulang formula di client). tone "warn" = I < H (merah, per spec). */
export interface ManualRecon {
  tone: "ok" | "warn";
  text: string;
  iVal: string;
  hVal: string;
}

type OptRow = ManualEntryRow & { _pending?: boolean };

// --- View murni & terkontrol (state + handler dipasok container) ------------

export interface ManualSectionViewProps {
  title: string;
  /** Prefiks id unik per seksi utk pasangan label⇄input. */
  idBase: string;
  rows: OptRow[];
  recon?: ManualRecon | null;
  /** id baris yang sedang minta konfirmasi void (null = tidak ada). */
  confirmId?: string | null;
  adding: boolean;
  ket: string;
  amount: string;
  err?: string | null;
  success?: string | null;
  pending: boolean;
  onAddToggle: () => void;
  onCancelAdd: () => void;
  onKetChange: (v: string) => void;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
  onAskVoid: (id: string) => void;
  onConfirmVoid: (id: string) => void;
  onCancelVoid: () => void;
  ketInputRef?: React.Ref<HTMLInputElement>;
  addToggleRef?: React.Ref<HTMLButtonElement>;
  confirmYesRef?: React.Ref<HTMLButtonElement>;
  registerVoidBtn?: (id: string, el: HTMLButtonElement | null) => void;
}

export function ManualSectionView(p: ManualSectionViewProps) {
  const subtotal = p.rows.reduce((s, r) => s + r.amount, 0);
  const amt = parseAmount(p.amount);

  return (
    <section className="manual-card" aria-label={p.title}>
      <div className="manual-head">
        <span className="fs16 w700 t-brand">{p.title}</span>
        <ManualSourceBadge />
        <span className="fs15 t-tertiary manual-count">
          {p.rows.length} entri
        </span>
        <span className="fs16 w700 num nowrap manual-subtotal">{rp(subtotal)}</span>
      </div>

      {p.recon && (
        <div className={`manual-recon ${p.recon.tone}`} role="status">
          <span className={`dot ${p.recon.tone === "ok" ? "success" : "danger"}`} />
          <span className="fs15 w600 manual-recon-text">
            {p.recon.tone === "ok" ? "✓ " : "⚠ "}
            {p.recon.text}
          </span>
          <span className="fs15 num nowrap manual-recon-nums">
            I {p.recon.iVal} · H {p.recon.hVal}
          </span>
        </div>
      )}

      {p.rows.length === 0 ? (
        <div className="empty-inline">Belum ada entri untuk tanggal ini.</div>
      ) : (
        <div>
          <div className="manual-grid manual-grid-head">
            <span>No</span>
            <span>Keterangan</span>
            <span className="right">Jumlah (Rp)</span>
            <span>
              <span className="sr-only">Aksi</span>
            </span>
          </div>
          {p.rows.map((r, i) => {
            const confirming = p.confirmId === r.id;
            return (
              <div
                key={r.id}
                className={`manual-grid manual-row${r._pending ? " pending" : ""}${confirming ? " confirming" : ""}`}
                aria-busy={r._pending}
              >
                <span className="fs15 t-tertiary num">{i + 1}</span>
                <span className="fs16 t-primary manual-ket">{r.keterangan}</span>
                <span className="fs16 right num nowrap manual-amt">{rp(r.amount)}</span>
                <span className="manual-actioncell">
                  {!confirming && (
                    <button
                      type="button"
                      className="manual-void"
                      disabled={p.pending || r._pending}
                      aria-label={`Batalkan entri ${r.keterangan}`}
                      ref={(el) => p.registerVoidBtn?.(r.id, el)}
                      onClick={() => p.onAskVoid(r.id)}
                    >
                      Batalkan
                    </button>
                  )}
                </span>
                {confirming && (
                  <div
                    className="manual-confirm"
                    role="group"
                    aria-label={`Konfirmasi pembatalan: ${r.keterangan}`}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        p.onCancelVoid();
                      }
                    }}
                  >
                    <span className="fs15 w600 t-danger">Batalkan entri ini?</span>
                    <button
                      type="button"
                      className="manual-void-yes"
                      ref={p.confirmYesRef}
                      disabled={p.pending}
                      onClick={() => p.onConfirmVoid(r.id)}
                    >
                      Ya, batalkan
                    </button>
                    <button
                      type="button"
                      className="btn-outline manual-void-no"
                      onClick={p.onCancelVoid}
                    >
                      Tidak
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="manual-addwrap">
        {!p.adding ? (
          <button type="button" className="btn-tint sm" ref={p.addToggleRef} onClick={p.onAddToggle}>
            + Tambah entri
          </button>
        ) : (
          <form
            className="manual-addform"
            onSubmit={(e) => {
              e.preventDefault();
              p.onSubmit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                p.onCancelAdd();
              }
            }}
          >
            <div className="manual-field">
              <label htmlFor={`${p.idBase}-ket`}>Keterangan</label>
              <input
                id={`${p.idBase}-ket`}
                className="manual-input"
                value={p.ket}
                ref={p.ketInputRef}
                onChange={(e) => p.onKetChange(e.target.value)}
                placeholder="mis. SETOR BANK"
              />
            </div>
            <div className="manual-field">
              <label htmlFor={`${p.idBase}-amt`}>Jumlah (Rp)</label>
              <input
                id={`${p.idBase}-amt`}
                className="manual-input manual-input-amt num"
                inputMode="numeric"
                value={p.amount}
                onChange={(e) => p.onAmountChange(e.target.value)}
                placeholder="0"
              />
              <span className="fs15 t-tertiary num right manual-preview" aria-hidden="true">
                {p.amount ? rp(amt) : " "}
              </span>
            </div>
            <div className="manual-form-actions">
              <LoadingButton
                pending={p.pending}
                type="submit"
                className="btn-navy"
                pendingLabel="Menyimpan…"
              >
                Simpan
              </LoadingButton>
              <button type="button" className="btn-outline" onClick={p.onCancelAdd}>
                Batal
              </button>
            </div>
          </form>
        )}
        {(p.err || p.success) && (
          <div className="manual-msg mt2">
            {p.err ? (
              <StateView state="error" inline error={p.err} />
            ) : (
              <StateView state="success" successText={p.success} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// --- Container stateful -------------------------------------------------------

type OptAction = { kind: "add"; row: OptRow } | { kind: "void"; id: string };

export function ManualEntryForm({
  code,
  date,
  section,
  title,
  entries,
  recon,
}: {
  code: string;
  date: string;
  section: ManualSection;
  title: string;
  entries: ManualEntryRow[];
  recon?: ManualRecon | null;
}) {
  const [ket, setKet] = useState("");
  const [amount, setAmount] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);

  const [optEntries, applyOpt] = useOptimistic<OptRow[], OptAction>(entries, (state, action) =>
    action.kind === "add"
      ? [...state, action.row]
      : state.filter((e) => e.id !== action.id),
  );

  // Fokus mengikuti state (a11y): buka form → input keterangan; buka konfirmasi
  // → "Ya, batalkan"; Esc/Batal/Tidak → kembali ke kontrol pemicunya.
  const ketInputRef = useRef<HTMLInputElement>(null);
  const addToggleRef = useRef<HTMLButtonElement>(null);
  const confirmYesRef = useRef<HTMLButtonElement>(null);
  const voidBtns = useRef(new Map<string, HTMLButtonElement>());
  const restoreVoidId = useRef<string | null>(null);
  const restoreAddToggle = useRef(false);

  const registerVoidBtn = (id: string, el: HTMLButtonElement | null): void => {
    if (el) voidBtns.current.set(id, el);
    else voidBtns.current.delete(id);
  };

  useEffect(() => {
    if (adding) ketInputRef.current?.focus();
    else if (restoreAddToggle.current) {
      addToggleRef.current?.focus();
      restoreAddToggle.current = false;
    }
  }, [adding]);

  useEffect(() => {
    if (confirmId) confirmYesRef.current?.focus();
    else if (restoreVoidId.current) {
      voidBtns.current.get(restoreVoidId.current)?.focus();
      restoreVoidId.current = null;
    }
  }, [confirmId]);

  const openAdd = (): void => {
    setErr(null);
    setSuccess(null);
    setAdding(true);
  };

  const cancelAdd = (): void => {
    setErr(null);
    restoreAddToggle.current = true;
    setAdding(false);
  };

  const submit = (): void => {
    if (pending) return; // anti double-submit (lapis kedua; tombol sudah disabled)
    setSuccess(null);
    const msg = validateEntry(ket, amount);
    if (msg) {
      setErr(msg);
      return;
    }
    setErr(null);
    const ketTrim = ket.trim();
    const amt = parseAmount(amount);
    start(async () => {
      applyOpt({
        kind: "add",
        row: { id: `opt-${seq.current++}`, keterangan: ketTrim, amount: amt, urut: 9_999, _pending: true },
      });
      const res = await addManualEntry({ code, date, section, keterangan: ketTrim, amount: amt });
      if (!res.ok) setErr(res.error); // isian DIPERTAHANKAN utk koreksi
      else {
        setKet("");
        setAmount("");
        setSuccess("Entri ditambahkan.");
        ketInputRef.current?.focus(); // siap entri berikutnya
      }
    });
  };

  const askVoid = (id: string): void => {
    setErr(null);
    setSuccess(null);
    setConfirmId(id);
  };

  const cancelVoid = (): void => {
    restoreVoidId.current = confirmId;
    setConfirmId(null);
  };

  const confirmVoid = (id: string): void => {
    setConfirmId(null);
    start(async () => {
      applyOpt({ kind: "void", id });
      const res = await voidManualEntry({ code, date, id });
      if (!res.ok) setErr(res.error);
      else setSuccess("Entri dibatalkan.");
    });
    // Baris (dan strip konfirmasi) hilang optimistic → parkir fokus ke kontrol
    // stabil terdekat agar tak jatuh ke <body>.
    addToggleRef.current?.focus();
  };

  return (
    <ManualSectionView
      title={title}
      idBase={`manual-${section}`}
      rows={optEntries}
      recon={recon}
      confirmId={confirmId}
      adding={adding}
      ket={ket}
      amount={amount}
      err={err}
      success={success}
      pending={pending}
      onAddToggle={openAdd}
      onCancelAdd={cancelAdd}
      onKetChange={(v) => {
        setKet(v);
        setErr(null);
      }}
      onAmountChange={(v) => {
        setAmount(sanitizeAmount(v));
        setErr(null);
      }}
      onSubmit={submit}
      onAskVoid={askVoid}
      onConfirmVoid={confirmVoid}
      onCancelVoid={cancelVoid}
      ketInputRef={ketInputRef}
      addToggleRef={addToggleRef}
      confirmYesRef={confirmYesRef}
      registerVoidBtn={registerVoidBtn}
    />
  );
}
