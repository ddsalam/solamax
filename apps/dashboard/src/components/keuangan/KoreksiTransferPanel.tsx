"use client";

/**
 * Daftar koreksi "Jadikan transfer" (rencana 2026-11-11 U6; R15–R17).
 *
 * Satu tombol per baris yang pasangannya TUNGGAL; "periksa manual" tanpa
 * tombol. Tombol baris hanya MEMBUKA langkah konfirmasi: kedua kaki, unit,
 * tanggal, nominal, 4 digit rekening, dan id8 ditampilkan, lalu pengguna wajib
 * mencentang "Saya yakin" — di SETIAP hari (keputusan Dion 11 Nov 2026 17:54
 * WIB). Hari tertutup: hanya HoF/super admin, dan alasannya wajib. Server
 * menegakkan ulang semuanya (`periksaKonfirmasiJadikan`, `vonisJadikanTransfer`).
 */
import { useState, useTransition } from "react";
import { jadikanTransfer } from "@/lib/transfer-kas-actions";
import { ringkasKakiJadikan } from "@/lib/transfer-kas-model";
import type { KoreksiManual, KoreksiSiap } from "@/lib/transfer-kas-queries";

const rp = (sen: number): string =>
  (sen / 100).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const id8 = (id: string): string => id.slice(0, 8);

/** Langkah konfirmasi satu baris — murni dari props, agar bisa diuji render statis. */
export function KonfirmasiJadikanTransfer({
  k,
  unitCode,
  unitNama,
  yakin,
  alasan,
  pending,
  onYakin,
  onAlasan,
  onKonfirmasi,
  onBatal,
}: {
  k: KoreksiSiap;
  unitCode: string;
  unitNama: string;
  yakin: boolean;
  alasan: string;
  pending: boolean;
  onYakin: (v: boolean) => void;
  onAlasan: (v: string) => void;
  onKonfirmasi: () => void;
  onBatal: () => void;
}) {
  const kaki = ringkasKakiJadikan({
    unitCode,
    tanggal: k.tanggal,
    nominalSen: k.nominalSen,
    rekening4: k.rekening4,
    kasKategori: k.kasKategori,
    bankId: k.bankId,
    kasId: k.kasId,
  });
  const siap = yakin && (!k.hariTutup || alasan.trim() !== "");
  return (
    <div className="keu-yakin" role="group" aria-label="Konfirmasi jadikan transfer">
      <span className="w600">Periksa kedua kaki sebelum mengoreksi</span>
      <span className="fs16">
        Unit {unitNama} ({kaki.unit}) · tanggal {kaki.tanggal} · Rp {rp(kaki.nominalSen)}
      </span>
      <span className="fs16">
        Kaki 1 — Kas Besar <b>{kaki.kasBesar.sisi}</b> &ldquo;{kaki.kasBesar.kategori}&rdquo; −Rp {rp(kaki.nominalSen)} (baris{" "}
        {kaki.kasBesar.baris}) — tetap, hanya ditautkan.
      </span>
      <span className="fs16">
        Kaki 2 — Bank {kaki.bank.rekening ?? k.namaBank} <b>{kaki.bank.sisi}</b> &ldquo;{kaki.bank.kategori}&rdquo; +Rp{" "}
        {rp(kaki.nominalSen)} — menggantikan baris bank {kaki.bank.barisLama} (&ldquo;Setoran Hasil Penjualan&rdquo;, dibatalkan).
      </span>
      {k.hariTutup && (
        <>
          <span className="fs16 t-warning">
            Hari ini sudah ditutup. Tanggal tetap {kaki.tanggal}; saldo kas dan bank serta selisih tutup harinya tidak berubah.
          </span>
          <input
            className="manual-input"
            placeholder="Alasan (wajib, hari sudah ditutup)"
            value={alasan}
            onChange={(e) => onAlasan(e.target.value)}
          />
        </>
      )}
      <label className="keu-attest">
        <input type="checkbox" checked={yakin} onChange={(e) => onYakin(e.target.checked)} />
        <span>Saya yakin ini transfer Kas Besar → bank dan kedua kaki di atas benar.</span>
      </label>
      <span>
        <button type="button" className="btn-navy sm" data-konfirmasi-jadikan="" onClick={onKonfirmasi} disabled={pending || !siap}>
          Konfirmasi: jadikan transfer
        </button>{" "}
        <button type="button" className="btn-outline sm" onClick={onBatal} disabled={pending}>
          Batal
        </button>
      </span>
    </div>
  );
}

export function KoreksiTransferPanel({
  code,
  unitNama,
  siap,
  periksaManual,
  bolehJadikan,
  bolehHariTutup,
}: {
  code: string;
  unitNama: string;
  siap: KoreksiSiap[];
  periksaManual: KoreksiManual[];
  bolehJadikan: boolean;
  bolehHariTutup: boolean;
}) {
  const [dibuka, setDibuka] = useState<string | null>(null);
  const [yakin, setYakin] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const buka = (bankId: string | null): void => {
    setDibuka(bankId);
    setYakin(false);
    setAlasan("");
  };

  const jalankan = (k: KoreksiSiap): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await jadikanTransfer({
        code,
        bankId: k.bankId,
        kasId: k.kasId,
        alasan,
        konfirmasi: { yakin: true, tanggal: k.tanggal, nominalSen: k.nominalSen, rekening4: k.rekening4 },
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg(res.pesan);
        buka(null);
      }
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
                {k.bulanTutup && (
                  <span className="fs16 t-warning">Bulan sudah ditutup — &ldquo;Jadikan transfer&rdquo; tidak bisa dijalankan. Bicarakan dengan HoF.</span>
                )}
                {k.dicocokkan && (
                  <span className="fs16 t-warning">Sudah dicocokkan dengan rekening koran — HoF membatalkan cocoknya dulu.</span>
                )}
                {bolehJadikan &&
                  !terhalang &&
                  (tombolHariTutup ? (
                    <span className="fs16 t-tertiary">Hari ini sudah ditutup — hanya Head of Finance yang mengoreksinya.</span>
                  ) : dibuka === k.bankId ? (
                    <KonfirmasiJadikanTransfer
                      k={k}
                      unitCode={code}
                      unitNama={unitNama}
                      yakin={yakin}
                      alasan={alasan}
                      pending={pending}
                      onYakin={setYakin}
                      onAlasan={setAlasan}
                      onKonfirmasi={() => jalankan(k)}
                      onBatal={() => buka(null)}
                    />
                  ) : (
                    <span className="keu-yakin">
                      <button type="button" className="btn-navy sm" onClick={() => buka(k.bankId)} disabled={pending}>
                        Jadikan transfer…
                      </button>
                    </span>
                  ))}
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
