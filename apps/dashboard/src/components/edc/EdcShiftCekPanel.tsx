"use client";

import { useState, useTransition } from "react";
import { PratinjauAngka } from "@/components/keuangan/PratinjauAngka";
import { bacaRupiah } from "@/lib/angka-input";
import { cekSlipEdc, simpanPetaKartu } from "@/lib/edc-shift-actions";
import {
  LABEL_STATUS_EDC,
  type BarisShiftEdc,
  type KartuTanpaPeta,
  type StatusShiftEdc,
} from "@/lib/edc-shift-model";

/**
 * Rincian Penjualan — "EDC per shift: cocokkan dengan slip settlement" (§10.25).
 * Panel PENGAWAS, no-print.
 *
 * Pengawas memegang slip fisik, jadi dialah yang mencocokkan. Angka yang
 * dibukukan tetap BRUTO EasyMax — slip hanya memeriksa. Setiap baris langsung
 * menjawab "cocok atau selisih berapa", sebelum Keuangan menyentuhnya.
 */

const rp = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

const NADA: Record<StatusShiftEdc, string> = {
  belum_dicek: "",
  cocok: "nada-hijau",
  selisih: "nada-kuning",
  berubah_sesudah_dicek: "nada-merah",
  dibukukan: "nada-hijau",
};

export function EdcShiftCekPanel({
  code,
  date,
  baris,
  kartuTanpaPeta,
  bolehCek,
  bolehPetakan,
  acquirerDikenal,
}: {
  code: string;
  date: string;
  baris: BarisShiftEdc[];
  kartuTanpaPeta: KartuTanpaPeta[];
  bolehCek: boolean;
  bolehPetakan: boolean;
  acquirerDikenal: string[];
}) {
  const [slip, setSlip] = useState<Record<string, string>>({});
  const [peta, setPeta] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (baris.length === 0 && kartuTanpaPeta.length === 0) return null;

  const simpanCek = (b: BarisShiftEdc): void => {
    setErr(null);
    setMsg(null);
    const h = bacaRupiah(slip[b.kunci] ?? "");
    if (h.keadaan !== "sah") {
      setErr(h.keadaan === "tolak" ? h.pesan : "Isi total yang tertera di slip settlement.");
      return;
    }
    start(async () => {
      const r = await cekSlipEdc({ code, date, cshift: b.cshift, acquirer: b.acquirer, slipRp: h.nilai });
      if (!r.ok) setErr(r.error);
      else {
        setMsg(`Shift ${b.cshift} ${b.acquirer} tercatat — tercatat atas nama Anda.`);
        setSlip((s) => ({ ...s, [b.kunci]: "" }));
      }
    });
  };

  const simpanPeta = (k: KartuTanpaPeta): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await simpanPetaKartu({ code, date, ckdkartu: k.ckdkartu, acquirer: peta[k.ckdkartu] ?? "" });
      if (!r.ok) setErr(r.error);
      else setMsg(`Kode kartu ${k.ckdkartu} dipetakan.`);
    });
  };

  return (
    <section className="card card-pad-lg mt8 no-print" aria-labelledby="edc-shift-h">
      <h3 id="edc-shift-h" className="text-h3">
        EDC per shift — cocokkan dengan slip settlement
      </h3>
      <p className="fs16 t-tertiary mt2">
        Angka EasyMax sudah terisi otomatis. Ketik <strong>total di slip settlement</strong> tiap mesin/bank per
        shift. Keuangan kemudian membukukannya ke EDC Penampungan. Foto slip: menyusul (opsional untuk sekarang).
      </p>

      {kartuTanpaPeta.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>{kartuTanpaPeta.length} kode kartu EasyMax belum dipetakan ke bank</b>
          <p className="keu-p">
            Penjualannya belum bisa dicocokkan maupun dibukukan sampai banknya ditetapkan
            {bolehPetakan ? "." : " — minta Head of Finance, Direksi, atau pengawas unit ini."}
          </p>
          <div className="edc-peta">
            {kartuTanpaPeta.map((k) => (
              <div className="edc-peta-baris" key={k.ckdkartu}>
                <span className="fs16">
                  <strong className="mono">{k.ckdkartu}</strong> · {k.namaKartu} · Rp {rp(k.rp)} ({k.n} trx)
                </span>
                {bolehPetakan && (
                  <span className="edc-peta-aksi">
                    <input
                      className="manual-input"
                      list="edc-acquirer-dikenal"
                      aria-label={`Bank untuk kode kartu ${k.ckdkartu}`}
                      placeholder={`contoh: ${k.namaKartu}`}
                      value={peta[k.ckdkartu] ?? ""}
                      onChange={(e) => setPeta((p) => ({ ...p, [k.ckdkartu]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn-outline sm"
                      onClick={() => simpanPeta(k)}
                      disabled={pending || (peta[k.ckdkartu] ?? "").trim() === ""}
                    >
                      Simpan peta
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          <datalist id="edc-acquirer-dikenal">
            {acquirerDikenal.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </div>
      )}

      {baris.length > 0 && (
        <div className="tbl-scroll mt6">
          <div className="grid-head cols-edcshift">
            <span>Shift</span>
            <span>Bank</span>
            <span className="right">EasyMax (bruto)</span>
            <span>Total di slip</span>
            <span>Status</span>
          </div>
          {baris.map((b) => {
            const h = bacaRupiah(slip[b.kunci] ?? "");
            const bisaIsi = bolehCek && b.status !== "dibukukan";
            return (
              <div className="grid-row cols-edcshift" key={b.kunci}>
                <span className="w600">{b.cshift}</span>
                <span>{b.acquirer}</span>
                <span className="right num">
                  {rp(b.easymaxRp)}
                  <span className="meta"> · {b.nTransaksi} trx</span>
                </span>
                <span>
                  {b.cek && <span className="fs16 num">Rp {rp(b.cek.slipRp)} </span>}
                  {bisaIsi && (
                    <span className="edc-slip-isi">
                      <input
                        className="manual-input num"
                        inputMode="numeric"
                        aria-label={`Total slip shift ${b.cshift} ${b.acquirer}`}
                        placeholder={b.cek ? "cocokkan ulang" : "contoh 12.500.000"}
                        value={slip[b.kunci] ?? ""}
                        onChange={(e) => setSlip((s) => ({ ...s, [b.kunci]: e.target.value }))}
                      />
                      <button
                        type="button"
                        className="btn-outline sm"
                        onClick={() => simpanCek(b)}
                        disabled={pending || h.keadaan !== "sah"}
                      >
                        {b.cek ? "Cocokkan ulang" : "Simpan"}
                      </button>
                      <PratinjauAngka hasil={h} />
                    </span>
                  )}
                </span>
                <span className="fs16">
                  <span className={`keu-chip ${NADA[b.status]}`}>{LABEL_STATUS_EDC[b.status]}</span>
                  {b.status === "selisih" && b.selisih !== null && (
                    <span className="keu-p t-warning">
                      slip {b.selisih > 0 ? "lebih" : "kurang"} Rp {rp(Math.abs(b.selisih))}
                    </span>
                  )}
                  {b.cek && (
                    <span className="keu-p t-tertiary">
                      dicek {b.cek.checkedByEmail ?? "—"} · {b.cek.checkedAt}
                    </span>
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
    </section>
  );
}
