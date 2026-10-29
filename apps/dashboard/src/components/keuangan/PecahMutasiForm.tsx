"use client";

/**
 * Pecah satu mutasi bank jadi beberapa baris (rencana 2026-10-29 U3; R9, AE6)
 * — mis. angsuran BPR = pokok ke pihak lawan kreditur + bunga ke beban.
 *
 * Selisih Σ baris − nominal ditampilkan langsung (dalam sen bulat, model yang
 * SAMA dengan server: `periksaPecahan`), dan tombol simpan menunggu selisih
 * Rp 0. Server memeriksa ulang semuanya; layar hanya mencegah kiriman yang
 * pasti ditolak.
 *
 * Baris berkategori beban / pendapatan lain-lain wajib menyebut kategori
 * operasionalnya: server menulis `manual_entry` pintu Finance bersamanya,
 * supaya laba ikut tercatat (U11 — baris kas saja tak menggeser laba).
 *
 * Tanggal di sini = tanggal mutasi bank. Bila hari itu sudah ditutup, server
 * membukukan semua baris ke hari terbuka berikutnya dengan tanggal asalnya (R28).
 */
import { useState, useTransition } from "react";
import { bacaRupiah } from "@/lib/angka-input";
import { pecahMutasi } from "@/lib/kas-actions";
import { KATEGORI_OPERASIONAL, sectionBeban } from "@/lib/klasifikasi-model";
import type { SisiKategori } from "@/lib/keuangan-kas";
import {
  kategoriPihakLawan,
  periksaPecahan,
  pihakLawanUntuk,
  rpSen,
  rupiahKeSen,
  type PilihanPihakLawan,
} from "@/lib/pihak-lawan-model";

interface Baris {
  nominal: string;
  katLabel: string;
  pihakId: string;
  ket: string;
  /** Kategori operasional — wajib untuk baris beban/pendapatan lain-lain (laba). */
  opKat: string;
}

const kosong = (): Baris => ({ nominal: "", katLabel: "", pihakId: "", ket: "", opKat: "" });

export function PecahMutasiForm({
  code,
  date,
  accountId,
  namaAkun,
  kategori,
  pihakLawan,
  onSelesai,
}: {
  code: string;
  date: string;
  accountId: string;
  namaAkun: string;
  kategori: { side: SisiKategori; label: string }[];
  pihakLawan: PilihanPihakLawan[];
  /** `null` = dibatalkan; selainnya pesan sukses. */
  onSelesai: (pesan: string | null) => void;
}) {
  const [jenis, setJenis] = useState<"debet" | "kredit">("kredit");
  const [tanggal, setTanggal] = useState(date);
  const [ket, setKet] = useState("");
  const [total, setTotal] = useState("");
  const [baris, setBaris] = useState<Baris[]>([kosong(), kosong()]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const kategoriSisi = kategori.filter((k) => k.side === jenis);
  // Tanda mengikuti JENIS, bukan diketik — sama dengan form mutasi tunggal.
  const bertanda = (teks: string): number | null => {
    const h = bacaRupiah(teks);
    if (h.keadaan !== "sah" || h.nilai === 0) return null;
    return jenis === "kredit" ? -Math.abs(h.nilai) : Math.abs(h.nilai);
  };
  const totalN = bertanda(total);
  const barisN = baris.map((b) => bertanda(b.nominal));
  const jumlahSen = barisN.reduce<number>((s, n) => s + (n === null ? 0 : (rupiahKeSen(n) ?? 0)), 0);
  const selisihSen = totalN === null ? null : jumlahSen - (rupiahKeSen(totalN) ?? 0);

  const ubah = (i: number, p: Partial<Baris>): void =>
    setBaris(baris.map((b, j) => (j === i ? { ...b, ...p } : b)));

  const simpan = (): void => {
    setErr(null);
    if (totalN === null || barisN.some((n) => n === null)) {
      setErr("Nominal mutasi dan setiap baris harus diisi dan bukan nol.");
      return;
    }
    const masukan = baris.map((b, i) => ({
      amount: barisN[i]!,
      categorySide: b.katLabel === "" ? null : jenis,
      categoryLabel: b.katLabel === "" ? null : b.katLabel,
      pihakLawanId: kategoriPihakLawan(b.katLabel) && b.pihakId !== "" ? b.pihakId : null,
      keterangan: b.ket,
      operationalCategory: sectionBeban(b.katLabel) !== null && b.opKat !== "" ? b.opKat : null,
    }));
    const salah = periksaPecahan({ jenis, total: totalN, baris: masukan });
    if (salah !== null) {
      setErr(salah);
      return;
    }
    start(async () => {
      const r = await pecahMutasi({
        code,
        date: tanggal,
        accountId,
        keterangan: ket,
        jenis,
        total: totalN,
        baris: masukan,
      });
      if (!r.ok) setErr(r.error);
      else onSelesai(`${r.n ?? 0} baris pecahan tersimpan di ${namaAkun}.`);
    });
  };

  return (
    <div className="card card-pad-lg keu-form">
      <h4 className="text-h3">Pecah mutasi — {namaAkun}</h4>
      <p className="fs16 t-tertiary mt2">
        Satu mutasi di rekening koran, beberapa baris klasifikasi. Jumlah baris harus tepat sama dengan
        nominal mutasinya — selisih Rp 1 pun ditolak.
      </p>
      <div className="keu-2col">
        <label className="keu-fld">
          <span className="keu-label">Jenis</span>
          <select
            className="manual-input"
            value={jenis}
            onChange={(e) => {
              setJenis(e.target.value as "debet" | "kredit");
              setBaris(baris.map((b) => ({ ...b, katLabel: "", pihakId: "" })));
            }}
          >
            <option value="kredit">Kredit (kas keluar)</option>
            <option value="debet">Debet (kas masuk)</option>
          </select>
        </label>
        <label className="keu-fld">
          <span className="keu-label">Tanggal mutasi (tanggal bank)</span>
          <input className="manual-input" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </label>
        <label className="keu-fld">
          <span className="keu-label">Nominal mutasi</span>
          <input
            className="manual-input num"
            inputMode="numeric"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="contoh 6.500.000"
          />
        </label>
        <label className="keu-fld">
          <span className="keu-label">Keterangan</span>
          <input className="manual-input" value={ket} onChange={(e) => setKet(e.target.value)} />
        </label>
      </div>

      {baris.map((b, i) => {
        const pilihan = pihakLawanUntuk(b.katLabel, pihakLawan);
        return (
          <div className="keu-2col mt4" key={i}>
            <label className="keu-fld">
              <span className="keu-label">Baris {i + 1} · nominal</span>
              <input
                className="manual-input num"
                inputMode="numeric"
                value={b.nominal}
                onChange={(e) => ubah(i, { nominal: e.target.value })}
              />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Kategori</span>
              <select
                className="manual-input"
                value={b.katLabel}
                onChange={(e) => ubah(i, { katLabel: e.target.value, pihakId: "", opKat: "" })}
              >
                <option value="">— pilih kategori —</option>
                {kategoriSisi.map((k) => (
                  <option key={k.label} value={k.label}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {kategoriPihakLawan(b.katLabel) && (
              <label className="keu-fld">
                <span className="keu-label">Pihak lawan (wajib)</span>
                <select className="manual-input" value={b.pihakId} onChange={(e) => ubah(i, { pihakId: e.target.value })}>
                  <option value="">— pilih pihak lawan —</option>
                  {pilihan.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nama}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {sectionBeban(b.katLabel) !== null && (
              <label className="keu-fld">
                <span className="keu-label">Kategori operasional (wajib — masuk laba)</span>
                <select className="manual-input" value={b.opKat} onChange={(e) => ubah(i, { opKat: e.target.value })}>
                  <option value="">— pilih kategori operasional —</option>
                  {KATEGORI_OPERASIONAL.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="keu-fld">
              <span className="keu-label">Keterangan baris (opsional)</span>
              <input className="manual-input" value={b.ket} onChange={(e) => ubah(i, { ket: e.target.value })} />
            </label>
          </div>
        );
      })}

      <div className="manual-form-actions">
        <button type="button" className="btn-outline sm" onClick={() => setBaris([...baris, kosong()])}>
          Tambah baris
        </button>
        {baris.length > 2 && (
          <button type="button" className="btn-outline sm" onClick={() => setBaris(baris.slice(0, -1))}>
            Hapus baris terakhir
          </button>
        )}
        <span className={`fs16 ${selisihSen === 0 ? "t-secondary" : "t-danger"}`}>
          {selisihSen === null ? "Isi nominal mutasi" : selisihSen === 0 ? "Selisih Rp 0" : `Selisih ${rpSen(selisihSen)}`}
        </span>
      </div>

      {err !== null && (
        <div className="banner danger keu-banner" role="alert">
          {err}
        </div>
      )}
      <div className="manual-form-actions">
        <button type="button" className="btn-navy" disabled={pending || selisihSen !== 0} onClick={simpan}>
          {pending ? "Menyimpan…" : "Simpan pecahan"}
        </button>
        <button type="button" className="btn-outline" disabled={pending} onClick={() => onSelesai(null)}>
          Batal
        </button>
      </div>
    </div>
  );
}
