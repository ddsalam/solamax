"use client";

import { useState, useTransition } from "react";
import { setujuiPencairan, simpanSettlement } from "@/lib/edc-actions";
import {
  jurnalSeimbang,
  mdrRp,
  pergeseranMdr,
  ringkasMdr,
  selisihSettlement,
  usulanJurnalPencairan,
  type RingkasMdr,
} from "@/lib/keuangan-edc";
import type { AkunKas } from "@/lib/keuangan-kas-model";
import type { SettlementRow } from "@/lib/keuangan-input-queries";

/**
 * Blok 3 Layar 3 — Settlement EDC (mockup layar 3).
 *
 * ⛔ **MDR TIDAK PERNAH DIKETIK.** Tak ada input MDR di berkas ini; angkanya
 * selalu `bruto − neto`, dan di DB ia kolom GENERATED (0030). Yang ditampilkan
 * di layar dihitung ulang dari kedua angka itu, bukan disimpan terpisah.
 *
 * ⛔ **Jurnal pencairan H+1 DITAWARKAN, bukan diposting** (§1.4). Ia muncul
 * sebagai tiga kaki yang bisa dibaca, dengan tombol yang menyetujui — bukan
 * sebagai baris yang sudah ada di buku.
 *
 * Kontrol MDR% per acquirer per bulan ikut ditampilkan: MDR adalah persentase
 * yang disepakati di perjanjian, jadi persentase yang BERGESER tanpa perubahan
 * perjanjian adalah temuan, bukan derau.
 */

const rp = (n: number): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const pct = (f: number | null): string => (f === null ? "—" : `${(f * 100).toFixed(3)} %`);

export function EdcPanel({
  code,
  date,
  settlements,
  akun,
  reasonCodes,
  bolehTulis,
}: {
  code: string;
  date: string;
  settlements: SettlementRow[];
  akun: AkunKas[];
  reasonCodes: { code: string; label: string }[];
  bolehTulis: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [acquirer, setAcquirer] = useState("");
  const [noSettle, setNoSettle] = useState("");
  const [tglSettle, setTglSettle] = useState(date);
  const [tglBisnis, setTglBisnis] = useState(date);
  const [akunTujuan, setAkunTujuan] = useState(akun.find((a) => a.kind === "bank")?.id ?? "");
  const [bruto, setBruto] = useState("");
  const [neto, setNeto] = useState("");
  const [txn, setTxn] = useState("");
  const [alasanKode, setAlasanKode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const namaAkun = (id: string): string => akun.find((a) => a.id === id)?.nama ?? id;
  const angka = (s: string): number => Number(s.replace(/[^\d]/g, ""));
  const brutoN = angka(bruto);
  const netoN = angka(neto);
  const txnN = txn.trim() === "" ? null : angka(txn);
  // MDR di layar = bruto − neto. Ditampilkan, tidak bisa diketik.
  const mdrPratinjau = brutoN > 0 && netoN > 0 ? brutoN - netoN : null;
  const selisihPratinjau = txnN === null ? null : txnN - brutoN;

  const ringkas: RingkasMdr[] = ringkasMdr(settlements);
  const geser = pergeseranMdr(ringkas);
  const belumCair = settlements.filter((s) => !s.void && !s.posted);

  const simpan = (): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await simpanSettlement({
        code,
        date,
        acquirer,
        settlementNo: noSettle,
        settlementDate: tglSettle,
        businessDate: tglBisnis,
        toAccountId: akunTujuan,
        grossRp: brutoN,
        netRp: netoN,
        txnTotalRp: txnN,
        reasonCode: alasanKode === "" ? null : alasanKode,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg("Batch settlement tersimpan. Jurnal pencairannya menunggu persetujuan.");
        setAcquirer("");
        setNoSettle("");
        setBruto("");
        setNeto("");
        setTxn("");
        setAlasanKode("");
        setBuka(false);
      }
    });
  };

  const setujui = (id: string): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await setujuiPencairan({ code, date, settlementId: id });
      if (!res.ok) setErr(res.error);
      else setMsg("Jurnal pencairan disetujui — tiga kakinya masuk, tercatat atas nama Anda.");
    });
  };

  return (
    <section aria-labelledby="blok-edc">
      <div className="section-h">
        <h3 id="blok-edc" className="text-h3">
          3 · Settlement EDC
        </h3>
        <span className="fs16 t-tertiary">
          MDR dihitung dari bruto − neto — tidak pernah diketik
        </span>
      </div>

      {msg !== null && (
        <div className="banner info keu-banner" role="status">
          {msg}
        </div>
      )}
      {err !== null && (
        <div className="banner danger keu-banner" role="alert">
          {err}
        </div>
      )}

      {geser.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>Persentase MDR bergeser tanpa keterangan</b>
          <ul className="keu-list">
            {geser.map((g) => (
              <li key={`${g.acquirer}-${g.ke}`}>
                <strong>{g.acquirer}</strong> — {pct(g.rasioDari)} ({g.dari}) → {pct(g.rasioKe)} (
                {g.ke}). MDR adalah persentase yang disepakati di perjanjian; pergeserannya
                adalah temuan, bukan derau.
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-edc">
          <span>Acquirer &amp; nomor</span>
          <span>Tanggal cair</span>
          <span className="right">Bruto</span>
          <span className="right">Neto</span>
          <span className="right">MDR</span>
          <span>Status</span>
        </div>
        {settlements.length === 0 ? (
          <div className="empty-inline">Belum ada batch settlement pada rentang ini.</div>
        ) : (
          settlements.map((s) => {
            const selisih = selisihSettlement(s);
            return (
              <div className="grid-row cols-edc" key={s.id}>
                <span className="w600">
                  {s.acquirer} <span className="fs16 t-tertiary">· {s.settlementNo}</span>
                  {selisih !== null && selisih !== 0 && (
                    <span className="keu-pill" title={`Selisih transaksi vs settlement: ${rp(selisih)}`}>
                      selisih {rp(selisih)} · {s.reasonCode ?? "tanpa kode"}
                    </span>
                  )}
                </span>
                <span className="fs16 t-secondary">
                  {s.settlementDate}
                  <span className="fs16 t-tertiary"> (jual {s.businessDate})</span>
                </span>
                <span className="right num">{rp(s.grossRp)}</span>
                <span className="right num t-secondary">{rp(s.netRp)}</span>
                {/* Dihitung, bukan dibaca dari kolom terpisah di layar ini. */}
                <span className="right num">{rp(mdrRp(s))}</span>
                <span className="fs16">
                  {s.void ? (
                    <span className="t-tertiary">dibatalkan</span>
                  ) : s.posted ? (
                    <span className="t-secondary">sudah dicairkan</span>
                  ) : (
                    <span className="keu-pill">menunggu persetujuan</span>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Jurnal yang DITAWARKAN — dibaca dulu, baru disetujui. */}
      {belumCair.map((s) => {
        const baris = usulanJurnalPencairan(s, "EDC Penampungan");
        return (
          <div className="card card-pad-lg keu-form" key={`j-${s.id}`}>
            <h4 className="text-h3">
              Usulan jurnal pencairan — {s.acquirer} {s.settlementDate}
            </h4>
            <p className="fs16 t-tertiary mt2">
              Belum masuk buku. Angka di bawah dihitung dari batch-nya; yang Anda lakukan
              adalah menyetujui.
            </p>
            <div className="card tbl-card tbl-scroll mt4">
              <div className="grid-head cols-jurnal">
                <span>Akun</span>
                <span>Keterangan</span>
                <span className="right">Debet / (Kredit)</span>
              </div>
              {baris.map((b, i) => (
                <div className="grid-row cols-jurnal" key={i}>
                  <span className="w600">
                    {b.bukanAkunKas ? b.akun : namaAkun(b.akun)}
                    {b.bukanAkunKas && (
                      <span className="keu-pill" title="Bukan akun kas — masuk beban non-kas">
                        bukan akun kas
                      </span>
                    )}
                  </span>
                  <span className="fs16 t-secondary">{b.keterangan}</span>
                  <span className={`right num ${b.amount < 0 ? "t-danger" : ""}`}>
                    {rp(b.amount)}
                  </span>
                </div>
              ))}
              <div className="grid-total cols-jurnal">
                <span>{jurnalSeimbang(baris) ? "Seimbang" : "TIDAK SEIMBANG"}</span>
                <span />
                <span className="right num">
                  {rp(baris.reduce((a, b) => a + b.amount, 0))}
                </span>
              </div>
            </div>
            {bolehTulis && (
              <div className="manual-form-actions">
                <button
                  type="button"
                  className="btn-navy"
                  onClick={() => setujui(s.id)}
                  disabled={pending || !jurnalSeimbang(baris)}
                >
                  Setujui pencairan
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* Kontrol MDR% per acquirer per bulan (§10.5). */}
      {ringkas.length > 0 && (
        <>
          <div className="section-h mt6">
            <h4 className="text-h3">MDR sebagai % omzet EDC</h4>
            <span className="fs16 t-tertiary">per acquirer per bulan</span>
          </div>
          <div className="card tbl-card tbl-scroll">
            <div className="grid-head cols-mdr">
              <span>Acquirer</span>
              <span>Bulan</span>
              <span className="right">Bruto</span>
              <span className="right">MDR</span>
              <span className="right">% MDR</span>
            </div>
            {ringkas.map((r) => (
              <div className="grid-row cols-mdr" key={`${r.acquirer}-${r.bulan}`}>
                <span className="w600">{r.acquirer}</span>
                <span className="fs16 t-secondary">{r.bulan}</span>
                <span className="right num">{rp(r.grossRp)}</span>
                <span className="right num t-secondary">{rp(r.mdrRp)}</span>
                <span className="right num">{pct(r.rasio)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {bolehTulis && !buka && (
        <div className="manual-form-actions">
          <button type="button" className="btn-tint sm" onClick={() => setBuka(true)}>
            Tambah batch settlement…
          </button>
        </div>
      )}

      {bolehTulis && buka && (
        <div className="card card-pad-lg keu-form">
          <h4 className="text-h3">Batch settlement baru</h4>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Acquirer</span>
              <input
                className="manual-input"
                value={acquirer}
                onChange={(e) => setAcquirer(e.target.value)}
                placeholder="mis. BCA"
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nomor settlement</span>
              <input
                className="manual-input"
                value={noSettle}
                onChange={(e) => setNoSettle(e.target.value)}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Tanggal uang masuk (H+1)</span>
              <input
                className="manual-input"
                type="date"
                value={tglSettle}
                onChange={(e) => setTglSettle(e.target.value)}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Hari penjualan yang di-settle</span>
              <input
                className="manual-input"
                type="date"
                value={tglBisnis}
                onChange={(e) => setTglBisnis(e.target.value)}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Rekening tujuan neto</span>
              <select
                className="manual-input"
                value={akunTujuan}
                onChange={(e) => setAkunTujuan(e.target.value)}
              >
                {akun
                  .filter((a) => a.kind !== "edc_penampungan")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nama}
                    </option>
                  ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Bruto</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={bruto}
                onChange={(e) => setBruto(e.target.value)}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Neto diterima</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={neto}
                onChange={(e) => setNeto(e.target.value)}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Total transaksi EDC (opsional)</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={txn}
                onChange={(e) => setTxn(e.target.value)}
                placeholder="menurut mesin EDC / SolaMax"
              />
            </label>
          </div>

          {/* MDR: DITAMPILKAN, tak ada input-nya. */}
          <div className="banner info keu-banner" role="status">
            <b>MDR: {mdrPratinjau === null ? "—" : rp(mdrPratinjau)}</b>
            <p className="keu-p">
              Dihitung dari bruto − neto. Tidak ada kolom untuk mengetiknya, di layar ini
              maupun di basis data.
            </p>
          </div>

          {selisihPratinjau !== null && selisihPratinjau !== 0 && (
            <div className="banner warning keu-banner" role="status">
              <b>Total transaksi berbeda {rp(selisihPratinjau)} dari bruto settlement</b>
              <p className="keu-p">
                Selisih ini <strong>berdiri sebagai selisih</strong> — ia tidak dibulatkan
                hilang. Beri ia nama supaya bisa ditelusuri nanti.
              </p>
              <label className="keu-fld">
                <span className="keu-label">Kode alasan (wajib)</span>
                <select
                  className="manual-input"
                  value={alasanKode}
                  onChange={(e) => setAlasanKode(e.target.value)}
                >
                  <option value="">— pilih kode —</option>
                  {reasonCodes.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.code} — {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="manual-form-actions">
            <button type="button" className="btn-navy" onClick={simpan} disabled={pending}>
              {pending ? "Menyimpan…" : "Simpan batch"}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setBuka(false)}
              disabled={pending}
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
