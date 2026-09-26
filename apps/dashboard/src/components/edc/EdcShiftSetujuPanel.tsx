"use client";

import { useState, useTransition } from "react";
import { setujuiPenjualanEdc } from "@/lib/edc-shift-actions";
import {
  bolehDisetujui,
  butuhAlasan,
  LABEL_STATUS_EDC,
  type BarisShiftEdc,
  type KartuTanpaPeta,
  type StatusShiftEdc,
} from "@/lib/edc-shift-model";

/**
 * Input keuangan blok 3 — "Penjualan EDC per shift → EDC Penampungan" (§10.25).
 *
 * Pola yang sama dengan setoran pengawas: nominalnya sudah diketahui sistem
 * (bruto EasyMax), pengawas sudah mencocokkannya dengan slip, dan yang
 * dilakukan Keuangan adalah MENYETUJUI — persetujuannya tercatat atas namanya.
 * Baris berselisih tidak bisa disetujui tanpa kode alasan; selisihnya tidak
 * dibulatkan hilang.
 */

const rp = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

const NADA: Record<StatusShiftEdc, string> = {
  belum_dicek: "",
  cocok: "nada-hijau",
  selisih: "nada-kuning",
  berubah_sesudah_dicek: "nada-merah",
  dibukukan: "nada-hijau",
};

export function EdcShiftSetujuPanel({
  code,
  date,
  baris,
  kartuTanpaPeta,
  reasonCodes,
  bolehTulis,
  adaAkunEdc,
}: {
  code: string;
  date: string;
  baris: BarisShiftEdc[];
  kartuTanpaPeta: KartuTanpaPeta[];
  reasonCodes: { code: string; label: string }[];
  bolehTulis: boolean;
  adaAkunEdc: boolean;
}) {
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [alasan, setAlasan] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (baris.length === 0 && kartuTanpaPeta.length === 0) return null;

  const siap = baris.filter(bolehDisetujui);
  const dipilih = siap.filter((b) => b.cek && pilih.has(b.cek.id));
  const kurangAlasan = dipilih.filter((b) => butuhAlasan(b) && !alasan[b.cek!.id]);
  const nilaiDipilih = dipilih.reduce((s, b) => s + (b.cek?.easymaxRp ?? 0), 0);
  const menungguPengawas = baris.filter((b) => b.status === "belum_dicek" || b.status === "berubah_sesudah_dicek");

  const setujui = (): void => {
    setErr(null);
    setMsg(null);
    if (kurangAlasan.length > 0) {
      setErr("Pilih kode alasan untuk setiap shift yang berselisih.");
      return;
    }
    start(async () => {
      const r = await setujuiPenjualanEdc({
        code,
        date,
        pilihan: dipilih.map((b) => ({ cekId: b.cek!.id, reasonCode: alasan[b.cek!.id] ?? null })),
      });
      if (!r.ok) setErr(r.error);
      else {
        setMsg(`${r.n ?? 0} shift dibukukan ke EDC Penampungan — tercatat atas nama Anda.`);
        setPilih(new Set());
      }
    });
  };

  return (
    <div className="card card-pad-lg mt6" aria-labelledby="edc-setuju-h">
      <h4 id="edc-setuju-h" className="text-h3">
        Penjualan EDC per shift → EDC Penampungan
      </h4>
      <p className="fs16 t-tertiary mt2">
        Nominal = bruto EasyMax, sudah dicocokkan pengawas dengan slip settlement. Yang Anda lakukan di sini adalah
        menyetujui. Saat dana cair (H+1), batch settlement di bawah mengkredit EDC Penampungan.
      </p>

      {!adaAkunEdc && (
        <div className="banner warning keu-banner" role="status">
          <b>Unit ini belum punya akun EDC Penampungan</b>
          <p className="keu-p">Daftarkan dulu di Kelola akun kas — tanpa akun itu penjualan EDC tak bisa dibukukan.</p>
        </div>
      )}
      {kartuTanpaPeta.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>
            {kartuTanpaPeta.length} kode kartu belum dipetakan ke bank (Rp{" "}
            {rp(kartuTanpaPeta.reduce((s, k) => s + k.rp, 0))})
          </b>
          <p className="keu-p">
            {kartuTanpaPeta.map((k) => `${k.ckdkartu} (${k.namaKartu})`).join(", ")} — dipetakan oleh Head of Finance,
            Direksi, atau pengawas di layar Rincian Penjualan.
          </p>
        </div>
      )}
      {menungguPengawas.length > 0 && (
        <p className="fs16 t-secondary mt4">
          {menungguPengawas.length} shift menunggu pengawas mencocokkan slip (di Rincian Penjualan).
        </p>
      )}

      {baris.length > 0 && (
        <div className="tbl-scroll mt4">
          <div className="grid-head cols-edcsetuju">
            <span />
            <span>Shift · Bank</span>
            <span className="right">EasyMax</span>
            <span className="right">Slip</span>
            <span>Status</span>
            <span>Kode alasan</span>
          </div>
          {baris.map((b) => {
            const bisa = bolehTulis && adaAkunEdc && bolehDisetujui(b) && b.cek !== null;
            const id = b.cek?.id ?? b.kunci;
            return (
              <div className="grid-row cols-edcsetuju" key={b.kunci}>
                <span>
                  {bisa && (
                    <input
                      type="checkbox"
                      aria-label={`Pilih shift ${b.cshift} ${b.acquirer}`}
                      checked={pilih.has(id)}
                      onChange={(e) =>
                        setPilih((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(id);
                          else n.delete(id);
                          return n;
                        })
                      }
                    />
                  )}
                </span>
                <span className="w600">
                  Shift {b.cshift} · {b.acquirer}
                  {b.cek && <span className="keu-p t-tertiary">dicek {b.cek.checkedByEmail ?? "—"}</span>}
                </span>
                <span className="right num">{rp(b.easymaxRp)}</span>
                <span className="right num">{b.cek ? rp(b.cek.slipRp) : "—"}</span>
                <span className="fs16">
                  <span className={`keu-chip ${NADA[b.status]}`}>{LABEL_STATUS_EDC[b.status]}</span>
                  {b.status === "selisih" && b.selisih !== null && (
                    <span className="keu-p t-warning">
                      slip {b.selisih > 0 ? "lebih" : "kurang"} Rp {rp(Math.abs(b.selisih))}
                    </span>
                  )}
                </span>
                <span>
                  {bisa && butuhAlasan(b) ? (
                    <select
                      className="manual-input"
                      aria-label={`Kode alasan selisih shift ${b.cshift} ${b.acquirer}`}
                      value={alasan[id] ?? ""}
                      onChange={(e) => setAlasan((a) => ({ ...a, [id]: e.target.value }))}
                    >
                      <option value="">— pilih —</option>
                      {reasonCodes.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.code} · {r.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="t-tertiary">{b.cek?.reasonCode ?? "—"}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {bolehTulis && siap.length > 0 && (
        <div className="manual-form-actions">
          <button
            type="button"
            className="btn-navy"
            onClick={setujui}
            disabled={pending || dipilih.length === 0 || kurangAlasan.length > 0}
          >
            {pending
              ? "Menyimpan…"
              : dipilih.length === 0
                ? "Pilih shift yang akan dibukukan"
                : `Setujui ${dipilih.length} shift · Rp ${rp(nilaiDipilih)} ke EDC Penampungan`}
          </button>
        </div>
      )}

      {err && (
        <div className="banner danger keu-banner" role="alert">
          {err}
        </div>
      )}
      {msg && (
        <div className="banner info keu-banner" role="status">
          {msg}
        </div>
      )}
    </div>
  );
}
