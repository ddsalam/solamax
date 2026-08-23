"use client";

/**
 * Saldo pembuka per rekening — §10.24.
 *
 * ⛔ Hanya **Head of Finance** yang melihat formulirnya; yang lain melihat
 * angkanya. Menetapkan titik awal sebuah rekening lebih dekat ke *menyetujui*
 * daripada ke *mengetik* (§10.18).
 *
 * ⛔ **MENGGANTI, bukan menyunting.** Formulirnya tak pernah "mengedit" angka
 * lama: ia menetapkan yang baru, dan yang lama di-void beserta jejaknya. Karena
 * itu **alasan wajib** — dan kalimatnya menyebut kenapa, bukan sekadar menuntut.
 */
import { useState } from "react";
import { tetapkanSaldoAwal } from "@/lib/kas-actions";

export interface AkunSaldoAwal {
  id: string;
  nama: string;
  /** `null` = rekening ini belum punya titik awal. */
  cutOver: string | null;
  nominal: number | null;
  /** Mutasi yang bertanggal SEBELUM cut-over — dikeluarkan dari saldo. */
  praCutOver: number;
}

export function SaldoPembukaPanel({
  code,
  akun,
  bolehTetapkan,
}: {
  code: string;
  akun: AkunSaldoAwal[];
  bolehTetapkan: boolean;
}) {
  const [buka, setBuka] = useState<string | null>(null);
  const [tanggal, setTanggal] = useState("");
  const [nominal, setNominal] = useState("");
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function simpan(accountId: string) {
    setPending(true);
    setGalat(null);
    const r = await tetapkanSaldoAwal({
      code,
      accountId,
      date: tanggal,
      amount: Number(nominal.replace(/[^\d-]/g, "")),
      alasan,
    });
    setPending(false);
    if (!r.ok) {
      setGalat(r.error);
      return;
    }
    setBuka(null);
    setTanggal("");
    setNominal("");
    setAlasan("");
  }

  return (
    <section className="card card-pad-lg mt10" aria-labelledby="saldo-pembuka">
      <div className="section-h">
        <h3 id="saldo-pembuka" className="text-h3">
          Saldo pembuka
        </h3>
      </div>
      <p className="fs16 t-tertiary mt2">
        Titik awal tiap rekening, berikut tanggalnya. Tanpa ini, saldo yang terhitung hanya
        mutasi yang sudah diketik — dan neraca akan salah tanpa pernah berbunyi.
      </p>

      {akun.length === 0 ? (
        <div className="empty-inline mt6">Belum ada rekening untuk unit ini.</div>
      ) : (
        <div className="mt6">
          {akun.map((a) => (
            <div className="grid-row cols-akun" key={a.id}>
              <span className="w600">{a.nama}</span>
              <span className="fs16">
                {a.cutOver === null ? (
                  <span className="keu-chip keadaan-belum">Belum ditetapkan</span>
                ) : (
                  <>
                    <span className="keu-chip keadaan-siap">
                      {a.nominal === null ? "—" : a.nominal.toLocaleString("id-ID")}
                    </span>
                    <span className="fs16 t-tertiary keu-p">berlaku sejak {a.cutOver}</span>
                  </>
                )}
                {/* Pengecualiannya TERLIHAT, bukan diam (§10.24 butir 2). */}
                {a.praCutOver > 0 && (
                  <span className="fs16 t-danger keu-p">
                    {a.praCutOver} mutasi bertanggal sebelum {a.cutOver} dikeluarkan dari saldo —
                    menjumlahkannya bersama saldo pembuka akan menghitungnya dua kali.
                  </span>
                )}
              </span>
              <span className="fs16">
                {bolehTetapkan && (
                  <button
                    type="button"
                    className="btn-tint sm"
                    onClick={() => {
                      setBuka(buka === a.id ? null : a.id);
                      setGalat(null);
                    }}
                  >
                    {a.cutOver === null ? "Tetapkan" : "Ganti"}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {buka !== null && (
        <div className="card card-pad-lg keu-form mt6">
          <h4 className="text-h3">
            {akun.find((a) => a.id === buka)?.cutOver === null ? "Tetapkan" : "Ganti"} saldo pembuka
          </h4>
          <p className="fs16 t-tertiary mt2">
            Angka lama tidak disunting — ia dibatalkan dan diganti, dan keduanya tercatat. Itulah
            sebabnya alasannya wajib.
          </p>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Tanggal cut-over</span>
              <input
                className="manual-input"
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nominal (boleh negatif)</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
          <label className="keu-fld">
            <span className="keu-label">Alasan — dari mana angka ini berasal</span>
            <input
              className="manual-input"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
            />
          </label>
          {galat !== null && (
            <div className="banner danger keu-banner" role="alert">
              {galat}
            </div>
          )}
          <div className="manual-form-actions">
            <button
              type="button"
              className="btn-navy"
              disabled={pending}
              onClick={() => void simpan(buka)}
            >
              {pending ? "Menyimpan…" : "Simpan saldo pembuka"}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={pending}
              onClick={() => setBuka(null)}
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
