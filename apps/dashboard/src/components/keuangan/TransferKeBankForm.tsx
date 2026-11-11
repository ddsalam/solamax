"use client";

/**
 * "Setor dari Kas Besar ke bank" — SATU isian, DUA kaki bertaut (rencana
 * 2026-11-11 U4; R1, R2, R8, R10).
 *
 * Finance tak lagi mengetik kaki bank terpisah dan memilih labelnya sendiri —
 * pilihan itulah yang melahirkan 36 baris bank "Setoran Hasil Penjualan" yang
 * mengkredit 1103 dua kali. Kategori kedua kaki ditetapkan server ("Setoran ke
 * Bank" di Kas Besar, "Pindah Buku" di bank); form hanya meminta rekening
 * tujuan, nominal, dan keterangan. Tanggal = tanggal halaman; hari tertutup ⇒
 * server membukukan keduanya maju bersama.
 *
 * Kunci idempotensi dibuat saat form dibuka dan diganti sesudah sukses:
 * kiriman ganda dengan kunci sama tak menulis apa pun (KTD5).
 */
import { useState, useTransition } from "react";
import { bacaRupiah } from "@/lib/angka-input";
import type { AkunKas } from "@/lib/keuangan-kas-model";
import { catatTransferKeBank } from "@/lib/transfer-kas-actions";
import { PratinjauAngka } from "./PratinjauAngka";

const rp = (n: number): string => n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function TransferKeBankForm({
  code,
  date,
  akunBank,
  onSelesai,
}: {
  code: string;
  date: string;
  /** Rekening bank AKTIF unit ini — server memeriksa ulang jenis & unitnya. */
  akunBank: AkunKas[];
  /** `null` = dibatalkan; selainnya pesan sukses. */
  onSelesai: (pesan: string | null) => void;
}) {
  const [kunci, setKunci] = useState<string>(() => crypto.randomUUID());
  const [rekening, setRekening] = useState<string>(akunBank.length === 1 ? akunBank[0]!.id : "");
  const [nominal, setNominal] = useState("");
  const [ket, setKet] = useState(`Setoran ke Bank ${date}`);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const h = bacaRupiah(nominal);
  const nilai = h.keadaan === "sah" && h.nilai > 0 ? h.nilai : null;
  const namaBank = akunBank.find((a) => a.id === rekening)?.nama ?? null;
  const siap = nilai !== null && namaBank !== null && ket.trim() !== "";

  const simpan = (): void => {
    if (!siap || nilai === null || pending) return;
    const amount = nilai;
    setErr(null);
    start(async () => {
      const res = await catatTransferKeBank({ code, date, bankAccountId: rekening, amount, keterangan: ket, kunci });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setKunci(crypto.randomUUID());
      setNominal("");
      onSelesai(res.pesan);
    });
  };

  return (
    <div className="card card-pad-lg keu-form" data-form="transfer-ke-bank">
      <h4 className="text-h3">Setor dari Kas Besar ke bank</h4>
      <p className="fs16 t-tertiary mt2">
        Satu isian mencatat kedua sisi: Kas Besar keluar dan rekening bank masuk, tertaut sebagai satu transfer.
        Tak perlu mengetik baris di tab bank.
      </p>
      {akunBank.length === 0 ? (
        <div className="banner warning keu-banner" role="status">
          Unit ini belum punya rekening bank aktif — daftarkan dulu di Kelola akun kas.
        </div>
      ) : (
        <>
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Rekening tujuan</span>
              <select className="manual-input" value={rekening} onChange={(e) => setRekening(e.target.value)}>
                <option value="">— pilih rekening bank —</option>
                {akunBank.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nama}
                  </option>
                ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nominal</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                placeholder="contoh 399.979.000"
              />
              <PratinjauAngka hasil={h} />
            </label>
          </div>
          <label className="keu-fld">
            <span className="keu-label">Keterangan</span>
            <input className="manual-input" value={ket} onChange={(e) => setKet(e.target.value)} />
          </label>
          {siap && (
            <p className="fs16 t-secondary keu-p" data-pratinjau="transfer">
              Akan tercatat dua baris yang tertaut: Kas Besar keluar Rp {rp(nilai)} (Setoran ke Bank) dan {namaBank} masuk
              Rp {rp(nilai)} (Pindah Buku). Membatalkan satu baris membatalkan keduanya.
            </p>
          )}
        </>
      )}
      {err !== null && (
        <div className="banner danger keu-banner" role="alert">
          {err}
        </div>
      )}
      <div className="manual-form-actions">
        <button type="button" className="btn-navy" onClick={simpan} disabled={pending || !siap}>
          {pending ? "Menyimpan…" : "Simpan transfer"}
        </button>
        <button type="button" className="btn-outline" onClick={() => onSelesai(null)} disabled={pending}>
          Batal
        </button>
      </div>
    </div>
  );
}
