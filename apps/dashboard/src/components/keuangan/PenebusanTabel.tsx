"use client";

/**
 * Daftar penebusan satu bulan (rencana 2026-10-29 U7; R12) + pembatalan.
 * Produk & volume dibaca dari SO EasyMax; yang belum tertaut ditulis begitu,
 * bukan nol. Pembatalan hanya bila hari buku baris kasnya masih terbuka —
 * ditegakkan server (`batalkanPenebusan`); tombol ini hanya pintunya.
 */
import { useState, useTransition } from "react";
import { batalkanPenebusan } from "@/lib/penebusan-actions";
import type { PenebusanTampil } from "@/lib/penebusan-queries";
import { rpSen } from "@/lib/pihak-lawan-model";

const nota = (sen: number): string => (sen === 0 ? "—" : `${sen < 0 ? "−" : "+"}${rpSen(sen)}`);

export function PenebusanTabel({
  code,
  rows,
  bolehBatal,
}: {
  code: string;
  rows: PenebusanTampil[];
  bolehBatal: boolean;
}) {
  const [pending, start] = useTransition();
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [yakin, setYakin] = useState<string | null>(null);

  const batal = (id: string) => {
    setGalat(null);
    setPesan(null);
    start(async () => {
      const r = await batalkanPenebusan({ code, id });
      setYakin(null);
      if (!r.ok) setGalat(r.error);
      else setPesan(r.pesan);
    });
  };

  if (rows.length === 0) return <div className="empty-inline mt4">Belum ada penebusan tercatat di bulan ini.</div>;

  return (
    <>
      {pesan !== null && (
        <div className="banner info keu-banner" role="status">
          {pesan}
        </div>
      )}
      {galat !== null && (
        <div className="banner danger keu-banner" role="alert">
          {galat}
        </div>
      )}
      <div className="tbl-scroll mt4">
        <table className="fs16">
          <thead>
            <tr>
              <th className="left">SO</th>
              <th className="left">Tanggal bayar</th>
              <th className="left">Rekening</th>
              <th className="left">Produk · volume (EasyMax)</th>
              <th className="right">Net</th>
              <th className="right">PPN</th>
              <th className="right">PPh</th>
              <th className="right">PBBKB</th>
              <th className="right">Nota</th>
              <th className="right">Gross</th>
              {bolehBatal && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="w600">{r.noSo}</td>
                <td>
                  {r.tanggalBayar}
                  {r.hariBuku !== r.tanggalBayar && <span className="t-tertiary"> (dibukukan {r.hariBuku})</span>}
                  {!r.kasDibuat && <span className="keu-pill">baris kas manual diikat</span>}
                </td>
                <td>{r.rekening}</td>
                <td>
                  {r.tertaut ? (
                    <>
                      {r.produk} · <span className="num">{r.volume?.toLocaleString("id-ID") ?? "—"} L</span>
                    </>
                  ) : (
                    <span className="t-tertiary">belum tertaut</span>
                  )}
                </td>
                <td className="right num">{rpSen(r.netSen)}</td>
                <td className="right num">{rpSen(r.ppnSen)}</td>
                <td className="right num">{rpSen(r.pphSen)}</td>
                <td className="right num">{rpSen(r.pbbkbSen)}</td>
                <td className="right num">{nota(r.notaSen)}</td>
                <td className="right num w600">{rpSen(r.grossSen)}</td>
                {bolehBatal && (
                  <td>
                    {yakin === r.id ? (
                      <span>
                        <button type="button" className="btn-outline sm t-danger" disabled={pending} onClick={() => batal(r.id)}>
                          Ya, batalkan
                        </button>{" "}
                        <button type="button" className="btn-outline sm" onClick={() => setYakin(null)}>
                          Tidak
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setYakin(r.id)}>
                        Batalkan
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
