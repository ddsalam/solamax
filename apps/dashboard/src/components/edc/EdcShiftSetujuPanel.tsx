"use client";

import { useState, useTransition } from "react";
import { setujuiPenjualanEdc } from "@/lib/edc-shift-actions";
import {
  butuhAlasan,
  LABEL_STATUS_EDC,
  perluKeputusanFinance,
  type BarisShiftEdc,
  type KartuTanpaPeta,
  type StatusShiftEdc,
} from "@/lib/edc-shift-model";

/**
 * Input keuangan blok 3 — "EDC ditahan" (§10.25; rencana K6 U6 — R15, R16,
 * KTD7).
 *
 * Shift yang slipnya sama dengan EasyMax sudah TERPOSTING otomatis saat
 * pengawas mencocokkan slip — tak muncul di sini. Yang tersisa hanya keputusan
 * Finance: shift yang ditahan (slip ≠ EasyMax, atau pernah beda) diputuskan
 * SATU per SATU, dengan kode alasan bila berselisih; selisihnya tidak
 * dibulatkan hilang. Posting yang angka EasyMax-nya berubah sesudahnya hanya
 * ditandai — jalannya membatalkan baris Penjualan EDC di Buku Kas.
 */

const rp = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

const NADA: Record<StatusShiftEdc, string> = {
  belum_dicek: "",
  cocok: "nada-kuning",
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
  const [alasan, setAlasan] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (baris.length === 0 && kartuTanpaPeta.length === 0) return null;

  const ditahan = baris.filter(perluKeputusanFinance);
  const terposting = baris.filter((b) => b.status === "dibukukan" && !b.berubahSesudahDiposting);
  const menungguPengawas = baris.filter((b) => b.status === "belum_dicek" || b.status === "berubah_sesudah_dicek");

  const putuskan = (b: BarisShiftEdc): void => {
    setErr(null);
    setMsg(null);
    const cekId = b.cek?.id;
    if (!cekId) return;
    const kode = alasan[cekId] ?? null;
    if (butuhAlasan(b) && !kode) {
      setErr(`Pilih kode alasan untuk shift ${b.cshift} ${b.acquirer} yang berselisih.`);
      return;
    }
    start(async () => {
      const r = await setujuiPenjualanEdc({ code, date, pilihan: [{ cekId, reasonCode: kode }] });
      if (!r.ok) setErr(r.error);
      else setMsg(`Shift ${b.cshift} ${b.acquirer} dibukukan ke EDC Penampungan — tercatat atas nama Anda.`);
    });
  };

  return (
    <div className="card card-pad-lg mt6" aria-labelledby="edc-setuju-h">
      <h4 id="edc-setuju-h" className="text-h3">
        EDC ditahan{ditahan.length > 0 ? ` (${ditahan.length})` : ""}
      </h4>
      <p className="fs16 t-tertiary mt2">
        Shift yang slipnya sama dengan EasyMax sudah terposting otomatis ke EDC Penampungan saat pengawas mencocokkan
        slip. Di sini Anda hanya memutuskan shift yang ditahan. Saat dana cair (H+1), batch settlement di bawah
        mengkredit EDC Penampungan.
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

      {terposting.length > 0 && (
        <p className="fs16 t-secondary mt4">
          {terposting.length} shift sudah terposting otomatis (Rp {rp(terposting.reduce((s, b) => s + (b.cek?.easymaxRp ?? 0), 0))}).
        </p>
      )}
      {ditahan.length === 0 ? (
        <p className="fs16 t-secondary mt4">Tidak ada shift yang ditahan.</p>
      ) : (
        <div className="tbl-scroll mt4">
          <div className="grid-head cols-edcsetuju">
            <span />
            <span>Shift · Bank</span>
            <span className="right">EasyMax</span>
            <span className="right">Slip</span>
            <span>Status</span>
            <span>Keputusan</span>
          </div>
          {ditahan.map((b) => {
            const id = b.cek?.id ?? b.kunci;
            const bisa = bolehTulis && adaAkunEdc && !b.berubahSesudahDiposting && b.cek !== null;
            return (
              <div className="grid-row cols-edcsetuju" key={b.kunci}>
                <span />
                <span className="w600">
                  Shift {b.cshift} · {b.acquirer}
                  {b.cek && <span className="keu-p t-tertiary">dicek {b.cek.checkedByEmail ?? "—"}</span>}
                </span>
                <span className="right num">{rp(b.easymaxRp)}</span>
                <span className="right num">{b.cek ? rp(b.cek.slipRp) : "—"}</span>
                <span className="fs16">
                  {b.berubahSesudahDiposting ? (
                    <span className="keu-chip nada-merah">Berubah sesudah diposting</span>
                  ) : (
                    <span className={`keu-chip ${NADA[b.status]}`}>{LABEL_STATUS_EDC[b.status]}</span>
                  )}
                  {b.status === "selisih" && b.selisih !== null && (
                    <span className="keu-p t-warning">
                      slip {b.selisih > 0 ? "lebih" : "kurang"} Rp {rp(Math.abs(b.selisih))}
                    </span>
                  )}
                  {b.berubahSesudahDiposting && b.cek && (
                    <span className="keu-p t-warning">terposting Rp {rp(b.cek.easymaxRp)}</span>
                  )}
                </span>
                <span>
                  {b.berubahSesudahDiposting ? (
                    <span className="fs16 t-secondary">Batalkan baris Penjualan EDC di Buku Kas</span>
                  ) : bisa ? (
                    <span className="keu-p">
                      {butuhAlasan(b) && (
                        <select
                          className="manual-input"
                          aria-label={`Kode alasan selisih shift ${b.cshift} ${b.acquirer}`}
                          value={alasan[id] ?? ""}
                          onChange={(e) => setAlasan((a) => ({ ...a, [id]: e.target.value }))}
                        >
                          <option value="">— pilih kode alasan —</option>
                          {reasonCodes.map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.code} · {r.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="btn-navy mt2"
                        onClick={() => putuskan(b)}
                        disabled={pending || (butuhAlasan(b) && !alasan[id])}
                      >
                        {pending ? "Menyimpan…" : `Putuskan · Rp ${rp(b.cek?.easymaxRp ?? 0)}`}
                      </button>
                    </span>
                  ) : (
                    <span className="t-tertiary">{b.cek?.reasonCode ?? "—"}</span>
                  )}
                </span>
              </div>
            );
          })}
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
