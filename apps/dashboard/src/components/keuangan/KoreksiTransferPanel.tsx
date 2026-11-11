"use client";

/**
 * Daftar koreksi "Jadikan transfer" (rencana 2026-11-11 U6; R15–R17).
 *
 * Satu tombol per baris yang pasangannya TUNGGAL; "periksa manual" tanpa
 * tombol. Hari tertutup: tombol hanya bagi HoF/super admin, dan alasannya
 * wajib — server menegakkan ulang keduanya (`vonisJadikanTransfer`).
 */
import { useState, useTransition } from "react";
import { jadikanTransfer } from "@/lib/transfer-kas-actions";
import type { KoreksiManual, KoreksiSiap } from "@/lib/transfer-kas-queries";

const rp = (sen: number): string =>
  (sen / 100).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const id8 = (id: string): string => id.slice(0, 8);

export function KoreksiTransferPanel({
  code,
  siap,
  periksaManual,
  bolehJadikan,
  bolehHariTutup,
}: {
  code: string;
  siap: KoreksiSiap[];
  periksaManual: KoreksiManual[];
  bolehJadikan: boolean;
  bolehHariTutup: boolean;
}) {
  const [alasan, setAlasan] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const jalankan = (k: KoreksiSiap): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await jadikanTransfer({ code, bankId: k.bankId, kasId: k.kasId, alasan: alasan[k.bankId] ?? "" });
      if (!res.ok) setErr(res.error);
      else setMsg(res.pesan);
    });
  };

  return (
    <section aria-labelledby="koreksi-siap">
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

      <h3 id="koreksi-siap" className="text-h3">
        Siap dikoreksi ({siap.length})
      </h3>
      {siap.length === 0 ? (
        <div className="empty-inline">Tidak ada baris bank yang tampak sebagai kaki transfer dari Kas Besar.</div>
      ) : (
        <div className="card tbl-card tbl-scroll">
          {siap.map((k) => {
            const tombolHariTutup = k.hariTutup && !bolehHariTutup;
            const terhalang = k.bulanTutup || k.dicocokkan;
            return (
              <div className="grid-row" key={k.bankId} data-koreksi={k.bankId}>
                <span className="w600">
                  {k.tanggal} · {k.namaBank} · Rp {rp(k.nominalSen)}
                  <span className="keu-pill">{k.hariTutup ? "hari tutup" : "hari terbuka"}</span>
                </span>
                <span className="fs16 t-secondary">
                  {k.keterangan} — kaki Kas Besar: {k.kasKategori} ({id8(k.kasId)}) · baris bank {id8(k.bankId)}
                </span>
                {k.catatan !== null && <span className="fs16 t-tertiary">{k.catatan}</span>}
                {k.bulanTutup && <span className="fs16 t-warning">Bulan sudah ditutup — koreksi lewat jurnal memorial HoF.</span>}
                {k.dicocokkan && (
                  <span className="fs16 t-warning">Sudah dicocokkan dengan rekening koran — HoF membatalkan cocoknya dulu.</span>
                )}
                {bolehJadikan && !terhalang && (
                  <span className="keu-yakin">
                    {k.hariTutup && bolehHariTutup && (
                      <input
                        className="manual-input"
                        placeholder="Alasan (wajib, hari sudah ditutup)"
                        value={alasan[k.bankId] ?? ""}
                        onChange={(e) => setAlasan((a) => ({ ...a, [k.bankId]: e.target.value }))}
                      />
                    )}
                    {tombolHariTutup ? (
                      <span className="fs16 t-tertiary">Hari ini sudah ditutup — hanya Head of Finance yang mengoreksinya.</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-navy sm"
                        onClick={() => jalankan(k)}
                        disabled={pending || (k.hariTutup && (alasan[k.bankId] ?? "").trim() === "")}
                      >
                        Jadikan transfer
                      </button>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h3 className="text-h3 mt6">Periksa manual ({periksaManual.length})</h3>
      {periksaManual.length === 0 ? (
        <div className="empty-inline">Tidak ada.</div>
      ) : (
        <div className="card tbl-card tbl-scroll">
          {periksaManual.map((k) => (
            <div className="grid-row" key={k.bankId} data-periksa-manual={k.bankId}>
              <span className="w600">
                {k.tanggal} · {k.namaBank} · Rp {rp(k.nominalSen)} · baris {id8(k.bankId)}
              </span>
              <span className="fs16 t-secondary">{k.alasan}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
