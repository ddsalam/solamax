"use client";

import { useState, useTransition } from "react";
import {
  balikMemorial,
  bentukUlangBukuBesar,
  koreksiMajuBukuBesar,
  setujuiMemorial,
  simpanSaldoAwalPos,
  tolakMemorial,
  usulkanMemorial,
} from "@/lib/buku-besar-actions";
import { bacaRupiah } from "@/lib/angka-input";
import { rpSen, sebabPersetujuan } from "@/lib/buku-besar-memorial-model";

/**
 * Tindakan halaman Buku Besar (rencana 2026-11-02 K6 U9; R7–R9). Hanya
 * formulir dan tombol — wewenang dihitung DI SERVER (halaman meneruskan
 * hasilnya), dan setiap aksi memeriksanya lagi.
 */

type Hasil = { ok: boolean; error?: string; pesan?: string };

function useAksi() {
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const jalankan = (fn: () => Promise<Hasil>, sesudah?: () => void): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setErr(r.error ?? "Gagal.");
      else {
        setMsg(r.pesan ?? "Tersimpan.");
        sesudah?.();
      }
    });
  };
  const pesan = (
    <>
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
    </>
  );
  return { jalankan, pending, pesan };
}

/** Rupiah bulat isian → sen; `null` = tak terbaca. Pratinjau saja — server yang memutuskan. */
function senIsian(v: string, bolehNegatif = false): number | null {
  const h = bacaRupiah(v, { bolehNegatif });
  return h.keadaan === "kosong" ? 0 : h.keadaan === "sah" ? h.nilai * 100 : null;
}

// ---------------------------------------------------------------------------

export function BentukUlangTombol({ code, dari, sampai }: { code: string; dari: string; sampai: string }) {
  const { jalankan, pending, pesan } = useAksi();
  return (
    <div className="mt4">
      <button
        type="button"
        className="btn-outline sm"
        disabled={pending}
        onClick={() =>
          jalankan(async () => {
            const r = await bentukUlangBukuBesar({ code, dari, sampai });
            return r.ok ? { ok: true, pesan: `${r.pesan} ${r.temuan} temuan.` } : { ok: false, error: `${r.error} (${r.hariSelesai} hari selesai)` };
          })
        }
      >
        {pending ? "Membentuk ulang…" : "Bentuk ulang bulan ini"}
      </button>
      <span className="fs16 t-tertiary"> {dari} s.d. {sampai} · satu transaksi per hari, aman diulang</span>
      {pesan}
    </div>
  );
}

/** Bulan yang ditutup dengan buku besar: periksa ulang → koreksi maju (KTD3). */
export function KoreksiMajuTombol({ code, bulan }: { code: string; bulan: string }) {
  const { jalankan, pending, pesan } = useAksi();
  return (
    <div className="mt4">
      <button
        type="button"
        className="btn-outline sm"
        disabled={pending}
        onClick={() =>
          jalankan(async () => {
            const r = await koreksiMajuBukuBesar({ code, bulan });
            return r.ok ? { ok: true, pesan: r.pesan } : { ok: false, error: `${r.error} (${r.hariSelesai} hari selesai)` };
          })
        }
      >
        {pending ? "Memeriksa ulang…" : "Periksa ulang & koreksi maju"}
      </button>
      <span className="fs16 t-tertiary"> jurnal bulan ini tetap beku; selisih sumber yang berubah diposting di hari buka berikutnya</span>
      {pesan}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface PosIsian {
  kode: string;
  nama: string;
  /** Sisi normal untuk label ("debet"/"kredit"). */
  sisi: "debet" | "kredit";
  /** Nilai tersimpan di sisi normal, rupiah utuh (teks). */
  awal: string;
}

export function SaldoAwalForm({
  code,
  pos,
  kas,
}: {
  code: string;
  pos: PosIsian[];
  /** Saldo kas/bank dari rekening (sen, bertanda) — tampil sebagai bagian aset. */
  kas: { kode: string; saldoSen: number }[];
}) {
  const { jalankan, pending, pesan } = useAksi();
  const [nilai, setNilai] = useState<Record<string, string>>(() => Object.fromEntries(pos.map((p) => [p.kode, p.awal])));
  const [alasan, setAlasan] = useState("");

  let aset = kas.reduce((s, k) => s + k.saldoSen, 0);
  let kewajibanModal = 0;
  let salahKetik = false;
  for (const p of pos) {
    const sen = senIsian(nilai[p.kode] ?? "", true);
    if (sen === null) {
      salahKetik = true;
      continue;
    }
    const bertanda = p.sisi === "debet" ? sen : -sen;
    if (p.kode.startsWith("1")) aset += bertanda;
    else kewajibanModal -= bertanda;
  }
  const beda = aset - kewajibanModal;

  return (
    <section aria-labelledby="isi-saldo-awal" className="mt6">
      <div className="section-h">
        <h2 id="isi-saldo-awal" className="text-h3">
          Isi saldo awal
        </h2>
        <span className="fs16 t-tertiary">angka dari akuntan, di sisi normal pos · kosong = Rp 0</span>
      </div>
      <div className="tbl-scroll mt4">
        <table className="fs16">
          <thead>
            <tr>
              <th className="left">Pos</th>
              <th className="left">Sisi</th>
              <th>Saldo (Rp)</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.kode}>
                <td>
                  {p.kode} {p.nama}
                </td>
                <td className="t-secondary">{p.sisi}</td>
                <td>
                  <input
                    className="manual-input num"
                    inputMode="decimal"
                    aria-label={`Saldo awal ${p.kode} ${p.nama}`}
                    value={nilai[p.kode] ?? ""}
                    onChange={(e) => setNilai((s) => ({ ...s, [p.kode]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`fs16 mt2 ${beda === 0 && !salahKetik ? "t-secondary" : "t-danger"}`} role="status">
        Aset {rpSen(aset)} · kewajiban + modal {rpSen(kewajibanModal)}
        {salahKetik ? " · ada isian yang tak terbaca" : beda === 0 ? " · seimbang" : ` · beda ${rpSen(Math.abs(beda))}`}
      </p>
      <label className="keu-fld">
        <span className="keu-label">Alasan / sumber angka</span>
        <input className="manual-input" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. neraca akuntan per 30 Sep 2026" />
      </label>
      <div className="manual-form-actions mt4">
        <button
          type="button"
          className="btn-navy sm"
          disabled={pending || salahKetik || alasan.trim() === ""}
          onClick={() =>
            jalankan(() =>
              simpanSaldoAwalPos({ code, alasan, nilai: pos.map((p) => ({ posKode: p.kode, rupiah: nilai[p.kode] ?? "" })) }),
            )
          }
        >
          Simpan saldo awal
        </button>
      </div>
      {pesan}
    </section>
  );
}

// ---------------------------------------------------------------------------

type BarisIsian = { posKode: string; debet: string; kredit: string };
const barisKosong = (): BarisIsian => ({ posKode: "", debet: "", kredit: "" });

export function MemorialForm({
  code,
  tanggalAwal,
  pilihanPos,
}: {
  code: string;
  tanggalAwal: string;
  pilihanPos: { kode: string; nama: string }[];
}) {
  const { jalankan, pending, pesan } = useAksi();
  const [tanggal, setTanggal] = useState(tanggalAwal);
  const [alasan, setAlasan] = useState("");
  const [bukti, setBukti] = useState("");
  const [baris, setBaris] = useState<BarisIsian[]>([barisKosong(), barisKosong()]);

  const sen = baris.map((b) => ({ posKode: b.posKode, debetSen: senIsian(b.debet), kreditSen: senIsian(b.kredit) }));
  const terbaca = sen.every((b) => b.debetSen !== null && b.kreditSen !== null);
  const d = sen.reduce((s, b) => s + (b.debetSen ?? 0), 0);
  const k = sen.reduce((s, b) => s + (b.kreditSen ?? 0), 0);
  const sebab = terbaca
    ? sebabPersetujuan(sen.filter((b) => b.posKode !== "").map((b) => ({ posKode: b.posKode, debetSen: b.debetSen ?? 0, kreditSen: b.kreditSen ?? 0 })))
    : null;
  const ubah = (i: number, f: keyof BarisIsian, v: string) => setBaris((s) => s.map((b, j) => (j === i ? { ...b, [f]: v } : b)));

  return (
    <section aria-labelledby="memorial-baru" className="mt6">
      <div className="section-h">
        <h2 id="memorial-baru" className="text-h3">
          Jurnal memorial baru
        </h2>
        <span className="fs16 t-tertiary">
          lebih dari Rp 100.000, atau menyentuh 1103/1190/1198/1199/5130, menunggu persetujuan Direksi
        </span>
      </div>
      <div className="keu-2col mt4">
        <label className="keu-fld">
          <span className="keu-label">Tanggal</span>
          <input type="date" className="manual-input" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </label>
        <label className="keu-fld">
          <span className="keu-label">Bukti (nomor dokumen / tautan lampiran)</span>
          <input className="manual-input" value={bukti} onChange={(e) => setBukti(e.target.value)} />
        </label>
      </div>
      <label className="keu-fld">
        <span className="keu-label">Alasan</span>
        <input className="manual-input" value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. penyusutan Oktober" />
      </label>
      <div className="tbl-scroll mt4">
        <table className="fs16">
          <thead>
            <tr>
              <th className="left">Pos</th>
              <th>Debet (Rp)</th>
              <th>Kredit (Rp)</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((b, i) => (
              <tr key={i}>
                <td>
                  <select className="manual-input" value={b.posKode} aria-label={`Pos baris ${i + 1}`} onChange={(e) => ubah(i, "posKode", e.target.value)}>
                    <option value="">— pilih pos —</option>
                    {pilihanPos.map((p) => (
                      <option key={p.kode} value={p.kode}>
                        {p.kode} {p.nama}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input className="manual-input num" inputMode="decimal" aria-label={`Debet baris ${i + 1}`} value={b.debet} onChange={(e) => ubah(i, "debet", e.target.value)} />
                </td>
                <td>
                  <input className="manual-input num" inputMode="decimal" aria-label={`Kredit baris ${i + 1}`} value={b.kredit} onChange={(e) => ubah(i, "kredit", e.target.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn-outline sm mt2" onClick={() => setBaris((s) => [...s, barisKosong()])}>
        Tambah baris
      </button>
      <p className={`fs16 mt2 ${terbaca && d === k ? "t-secondary" : "t-danger"}`} role="status">
        Debet {rpSen(d)} · kredit {rpSen(k)}
        {!terbaca ? " · ada nominal yang tak terbaca" : d === k ? " · seimbang" : ` · beda ${rpSen(Math.abs(d - k))}`}
        {terbaca && d === k && d > 0 && (sebab ? ` · akan menunggu persetujuan (${sebab})` : " · langsung terposting")}
      </p>
      <div className="manual-form-actions mt4">
        <button
          type="button"
          className="btn-navy sm"
          disabled={pending || !terbaca || d !== k || d === 0 || alasan.trim() === "" || bukti.trim() === ""}
          onClick={() =>
            jalankan(
              () => usulkanMemorial({ code, tanggal, alasan, bukti, baris }),
              () => {
                setAlasan("");
                setBukti("");
                setBaris([barisKosong(), barisKosong()]);
              },
            )
          }
        >
          Simpan memorial
        </button>
      </div>
      {pesan}
    </section>
  );
}

// ---------------------------------------------------------------------------

/** Tombol per memorial: Setujui/Tolak (Direksi), Tarik (pengusul), Balik (HoF, memorial aktif). */
export function MemorialTombol({
  code,
  id,
  status,
  bolehSetujui,
  bolehTarik,
  bolehBalik,
  tanggalBalik,
}: {
  code: string;
  id: string;
  status: string;
  bolehSetujui: boolean;
  bolehTarik: boolean;
  bolehBalik: boolean;
  tanggalBalik: string;
}) {
  const { jalankan, pending, pesan } = useAksi();
  const [alasan, setAlasan] = useState("");
  const [tanggal, setTanggal] = useState(tanggalBalik);
  const menunggu = status === "menunggu";
  if (!(menunggu && (bolehSetujui || bolehTarik)) && !(status === "aktif" && bolehBalik)) return null;
  return (
    <div className="keu-yakin">
      <input className="manual-input" aria-label="Alasan" placeholder="alasan" value={alasan} onChange={(e) => setAlasan(e.target.value)} />
      {menunggu && bolehSetujui && (
        <button type="button" className="btn-navy sm" disabled={pending} onClick={() => jalankan(() => setujuiMemorial({ code, id }))}>
          Setujui
        </button>
      )}
      {menunggu && (bolehSetujui || bolehTarik) && (
        <button type="button" className="btn-outline sm" disabled={pending || alasan.trim() === ""} onClick={() => jalankan(() => tolakMemorial({ code, id, alasan }))}>
          {bolehSetujui ? "Tolak" : "Tarik usulan"}
        </button>
      )}
      {status === "aktif" && bolehBalik && (
        <>
          <input type="date" className="manual-input" aria-label="Tanggal pembalikan" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          <button type="button" className="btn-outline sm" disabled={pending || alasan.trim() === ""} onClick={() => jalankan(() => balikMemorial({ code, id, tanggal, alasan }))}>
            Batalkan (balik)
          </button>
        </>
      )}
      {pesan}
    </div>
  );
}
