"use client";

/**
 * Formulir penebusan per SO (rencana 2026-10-29 U7; R10, R11, R29).
 *
 * · Kaki "Σ komponen / Gross / Selisih" diperbarui saat mengetik; Simpan
 *   NONAKTIF selama selisih ≠ Rp 0 atau ada angka yang belum terbaca. Server
 *   memeriksa ulang dalam sen bulat (dan CHECK DB 0050) — kaki ini hanya
 *   memperlihatkan angka yang akan tersimpan.
 * · Nota Debet/Kredit SATU isian bertanda: nota debet menambah (+), nota kredit
 *   mengurangi (−). ⚠️ Tanda ini belum dicocokkan ke bukti nyata (tindak lanjut).
 * · Dibuka dengan `isianAwal` (U11 membukanya dari debit rekening koran): SO,
 *   tanggal, rekening, dan Gross tampil TERKUNCI berlabel "dari rekening koran".
 * · Kandidat ≥ 2 baris kas yang bisa diikat ⇒ Keuangan memilih; tak ditebak.
 */
import { useState, useTransition } from "react";
import { bacaRupiah } from "@/lib/angka-input";
import { simpanPenebusan } from "@/lib/penebusan-actions";
import { LABEL_KOMPONEN, ringkasKomponen, type KandidatKas, type Komponen } from "@/lib/penebusan-model";
import { rpSen } from "@/lib/pihak-lawan-model";
import { PratinjauAngka } from "./PratinjauAngka";

export interface IsianAwalPenebusan {
  noSo: string;
  tanggalBayar: string;
  accountId: string;
  /** Rupiah bulat. */
  gross: number;
  /**
   * U11 — baris rekening koran asal. Server membaca ulang SO/tanggal/rekening/
   * Gross dari baris ini dan mengikat baris kasnya ke baris impor (kelompok cocok).
   */
  mutasiBankId?: string;
}

type Teks = Record<Komponen | "gross", string>;
const KOSONG: Teks = { net: "", ppn: "", pph: "", pbbkb: "", nota: "", gross: "" };

const rp = (n: number): string => rpSen(n * 100);

export function PenebusanForm({
  code,
  rekening,
  isianAwal,
  onSelesai,
}: {
  code: string;
  rekening: { id: string; nama: string }[];
  isianAwal: IsianAwalPenebusan | null;
  /** Dipanggil dengan pesan sukses (dipakai layar klasifikasi U11). */
  onSelesai?: (pesan: string) => void;
}) {
  const [pending, start] = useTransition();
  const [galat, setGalat] = useState<string | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [kandidat, setKandidat] = useState<KandidatKas[] | null>(null);
  const [pilihKas, setPilihKas] = useState<string>("");

  const terkunci = isianAwal !== null;
  // Debit tanpa nomor SO terbaca di keterangannya: SO tetap diketik.
  const soTerkunci = terkunci && isianAwal.noSo.trim() !== "";
  const [noSo, setNoSo] = useState(isianAwal?.noSo ?? "");
  const [tanggal, setTanggal] = useState(isianAwal?.tanggalBayar ?? "");
  const [akun, setAkun] = useState(isianAwal?.accountId ?? "");
  const [teks, setTeks] = useState<Teks>({ ...KOSONG, gross: isianAwal ? String(isianAwal.gross) : "" });

  const k = ringkasKomponen(teks);
  const siap = k.lengkap && k.selisih === 0 && noSo.trim() !== "" && tanggal !== "" && akun !== "";
  const nilai = (f: Komponen | "gross"): number => {
    const h = bacaRupiah(teks[f], { bolehNegatif: f === "nota" });
    return h.keadaan === "sah" ? h.nilai : 0;
  };

  const ubah = (f: Komponen | "gross", v: string) => {
    setTeks((t) => ({ ...t, [f]: v }));
    setKandidat(null);
  };

  const simpan = (cashLedgerId: string | null) => {
    if (!siap) return;
    setGalat(null);
    setPesan(null);
    start(async () => {
      const r = await simpanPenebusan({
        code,
        noSo,
        tanggalBayar: tanggal,
        accountId: akun,
        net: nilai("net"),
        ppn: nilai("ppn"),
        pph: nilai("pph"),
        pbbkb: nilai("pbbkb"),
        nota: nilai("nota"),
        gross: nilai("gross"),
        cashLedgerId,
        mutasiBankId: isianAwal?.mutasiBankId ?? null,
      });
      if (!r.ok) {
        setGalat(r.error);
        setKandidat(r.kandidat ?? null);
        setPilihKas("");
        return;
      }
      setPesan(r.pesan);
      setKandidat(null);
      onSelesai?.(r.pesan);
      if (!terkunci) {
        setNoSo("");
        setTeks(KOSONG);
      } else {
        setTeks((t) => ({ ...KOSONG, gross: t.gross }));
      }
    });
  };

  const isianAngka = (f: Komponen | "gross", bantuan?: string) => {
    const kunci = f === "gross" && terkunci;
    return (
      <label className="keu-fld" key={f}>
        <span className="keu-label">
          {LABEL_KOMPONEN[f]}
          {kunci && <span className="keu-pill">dari rekening koran</span>}
        </span>
        <input
          className="manual-input num"
          inputMode="text"
          value={teks[f]}
          readOnly={kunci}
          onChange={(e) => ubah(f, e.target.value)}
          placeholder={f === "nota" ? "0 — atau −5.000 untuk nota kredit" : "contoh 11.000.000"}
        />
        {bantuan && <span className="fs16 t-tertiary keu-terbaca">{bantuan}</span>}
        <PratinjauAngka hasil={bacaRupiah(teks[f], { bolehNegatif: f === "nota" })} />
      </label>
    );
  };

  return (
    <div className="card card-pad-lg keu-form mt6">
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

      <div className="keu-2col">
        <label className="keu-fld">
          <span className="keu-label">
            Nomor SO{soTerkunci && <span className="keu-pill">dari rekening koran</span>}
          </span>
          <input className="manual-input" value={noSo} readOnly={soTerkunci} onChange={(e) => setNoSo(e.target.value)} />
        </label>
        <label className="keu-fld">
          <span className="keu-label">
            Tanggal bayar{terkunci && <span className="keu-pill">dari rekening koran</span>}
          </span>
          <input
            className="manual-input"
            type="date"
            value={tanggal}
            readOnly={terkunci}
            onChange={(e) => setTanggal(e.target.value)}
          />
        </label>
        <label className="keu-fld">
          <span className="keu-label">
            Rekening bank{terkunci && <span className="keu-pill">dari rekening koran</span>}
          </span>
          <select className="manual-input" value={akun} disabled={terkunci} onChange={(e) => setAkun(e.target.value)}>
            <option value="">— pilih rekening —</option>
            {rekening.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nama}
              </option>
            ))}
          </select>
        </label>
        {isianAngka("gross")}
        {isianAngka("net")}
        {isianAngka("ppn")}
        {isianAngka("pph")}
        {isianAngka("pbbkb")}
        {isianAngka("nota", "Nota debet menambah, nota kredit mengurangi (ketik dengan tanda minus).")}
      </div>

      <div className="grid-row mt4" aria-live="polite">
        <span className="fs16">
          Σ komponen <span className="num w600">{rp(k.jumlah)}</span>
        </span>
        <span className="fs16">
          Gross <span className="num w600">{k.gross === null ? "—" : rp(k.gross)}</span>
        </span>
        <span className={`fs16 ${k.selisih === 0 ? "t-secondary" : "t-danger"}`}>
          Selisih{" "}
          <span className="num w600">
            {k.selisih === null ? "—" : `${k.selisih < 0 ? "−" : k.selisih > 0 ? "+" : ""}${rp(Math.abs(k.selisih))}`}
          </span>
        </span>
      </div>

      {kandidat !== null && kandidat.length > 1 && (
        <fieldset className="mt4">
          <legend className="keu-label">Pilih baris kas yang dibayar untuk SO ini</legend>
          {kandidat.map((c) => (
            <label key={c.id} className="keu-fld">
              <span className="fs16">
                <input
                  type="radio"
                  name="kandidat-kas"
                  value={c.id}
                  checked={pilihKas === c.id}
                  onChange={() => setPilihKas(c.id)}
                />{" "}
                {c.businessDate}
                {c.tanggalAsal !== null && c.tanggalAsal !== c.businessDate && ` (asal ${c.tanggalAsal})`} ·{" "}
                {c.keterangan} · <span className="num">−{rpSen(c.amountSen)}</span>
              </span>
            </label>
          ))}
          <div className="manual-form-actions">
            <button type="button" className="btn-navy" disabled={pending || !siap || pilihKas === ""} onClick={() => simpan(pilihKas)}>
              {pending ? "Menyimpan…" : "Ikat ke baris terpilih"}
            </button>
          </div>
        </fieldset>
      )}

      <div className="manual-form-actions">
        <button type="button" className="btn-navy" disabled={pending || !siap} onClick={() => simpan(null)}>
          {pending ? "Menyimpan…" : "Simpan penebusan"}
        </button>
        {!siap && k.lengkap && k.selisih !== 0 && (
          <span className="fs16 t-danger">Simpan aktif bila selisihnya Rp 0.</span>
        )}
      </div>
    </div>
  );
}
