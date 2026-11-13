"use client";

/**
 * Atur termin pembayaran per unit (rencana 2026-11-13 U9; S4; R14–R16, F2).
 *
 * Tindakan BERNAMA, tiga saja: simpan termin bawaan unit, simpan pengecualian
 * satu pelanggan, hapus pengecualian satu pelanggan. Tak ada "Edit" generik dan
 * tak ada hapus termin bawaan (termin 0 hari sah — itu nilainya, bukan ketiadaan).
 *
 * ⛔ `bolehAtur` dihitung SERVER (`canAturTermin`). Menyembunyikan kolom isian
 * bukan kontrol akses — gerbangnya di server action (`termin-actions.ts`), yang
 * menolak sebelum membuka koneksi. Tanpa wewenang, tak satu pun kolom isian
 * termin atau tombol tindakan dirender; yang tersisa hanya kotak pencarian
 * (penyaring tampilan, tak mengirim apa pun ke server).
 *
 * Batas `min`/`maks` DITERIMA dari halaman (sumbernya `termin-tulis.ts`), bukan
 * diimpor di sini: berkas itu inti tulis sisi server dan tak boleh ikut ke
 * bundel peramban. Pemeriksaan di sini hanya kenyamanan; yang memutuskan tetap
 * `periksaTerminHari` di server.
 */
import { useState, useTransition } from "react";
import { hapusTerminPelanggan, tetapkanTerminPelanggan, tetapkanTerminUnit } from "@/lib/termin-actions";
import type { PelangganTerminRow, TerminUnitRow } from "@/lib/termin-queries";

/** Baris pelanggan yang dirender sekaligus; selebihnya diminta dipersempit lewat pencarian. */
export const TERMIN_BARIS_MAKS = 100;

export interface TerminBatas {
  min: number;
  maks: number;
}

type Hasil = { ok: true; pesan?: string } | { ok: false; error: string };
/** Tempat pesan terakhir ditampilkan: `"unit"` atau kode pelanggan. */
type Sasaran = { di: string; jenis: "pesan" | "galat"; teks: string };

/** `null` = bukan bilangan bulat dalam batas. Murni. */
export function bacaTerminHari(teks: string, batas: TerminBatas): number | null {
  const t = teks.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= batas.min && n <= batas.maks ? n : null;
}

/** Pengecualian (yatim dulu) di atas, lalu sisanya menurut nama. Murni. */
export function urutkanPelangganTermin(rows: readonly PelangganTerminRow[]): PelangganTerminRow[] {
  const peringkat = (r: PelangganTerminRow) => (r.terminHari === null ? 2 : r.diMaster ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      peringkat(a) - peringkat(b) ||
      (a.namaPelanggan ?? "").localeCompare(b.namaPelanggan ?? "", "id") ||
      a.kodePelanggan.localeCompare(b.kodePelanggan, "id"),
  );
}

/** Cocok nama ATAU kode, tanpa beda huruf besar/kecil. Murni. */
export function saringPelangganTermin(rows: readonly PelangganTerminRow[], cari: string): PelangganTerminRow[] {
  const q = cari.trim().toLowerCase();
  if (q === "") return [...rows];
  return rows.filter(
    (r) => r.kodePelanggan.toLowerCase().includes(q) || (r.namaPelanggan ?? "").toLowerCase().includes(q),
  );
}

const siapaKapan = (oleh: string | null, kapan: string | null): string | null =>
  kapan === null ? null : `${oleh ?? "akun yang sudah dihapus"} · ${kapan} WIB`;

export function TerminPanel({
  code,
  namaUnit,
  terminUnit,
  pelanggan,
  bolehAtur,
  pesanTakBoleh,
  batas,
  cariAwal = "",
}: {
  code: string;
  namaUnit: string;
  /** Termin bawaan yang berlaku; `null` = belum pernah diatur. */
  terminUnit: TerminUnitRow | null;
  /** Seluruh pelanggan master unit + pengecualian yatim (`getPelangganUntukTermin`). */
  pelanggan: PelangganTerminRow[];
  bolehAtur: boolean;
  /** Penjelasan bagi yang tak berwenang — satu sumber dengan server action. */
  pesanTakBoleh: string;
  batas: TerminBatas;
  /** Isi awal kotak pencarian. */
  cariAwal?: string;
}) {
  const [pending, start] = useTransition();
  const [sasaran, setSasaran] = useState<Sasaran | null>(null);
  const [isiUnit, setIsiUnit] = useState(terminUnit === null ? "" : String(terminUnit.terminHari));
  const [cari, setCari] = useState(cariAwal);
  // Satu baris pelanggan terbuka pada satu waktu.
  const [buka, setBuka] = useState<string | null>(null);
  const [isiPelanggan, setIsiPelanggan] = useState("");
  // Konfirmasi di tempat, seperti "Nonaktifkan" di Pihak lawan.
  const [yakinHapus, setYakinHapus] = useState<string | null>(null);

  const jalankan = (di: string, f: () => Promise<Hasil>, selesai?: () => void) => {
    setSasaran(null);
    start(async () => {
      const r = await f();
      if (!r.ok) setSasaran({ di, jenis: "galat", teks: r.error });
      else {
        setSasaran({ di, jenis: "pesan", teks: r.pesan ?? "Tersimpan." });
        selesai?.();
      }
    });
  };

  /** Pesan/galat tindakan terakhir, DI TEMPAT tindakannya. */
  const umpan = (di: string) =>
    sasaran !== null && sasaran.di === di ? (
      sasaran.jenis === "galat" ? (
        <span className="fs16 t-danger keu-p" role="alert" data-termin-galat>
          {sasaran.teks}
        </span>
      ) : (
        <span className="fs16 t-secondary keu-p" role="status" data-termin-pesan>
          {sasaran.teks}
        </span>
      )
    ) : null;

  const nilaiUnit = bacaTerminHari(isiUnit, batas);
  const nilaiPelanggan = bacaTerminHari(isiPelanggan, batas);
  const rentang = `${batas.min}–${batas.maks} hari`;

  const cocok = saringPelangganTermin(urutkanPelangganTermin(pelanggan), cari);
  const tampil = cocok.slice(0, TERMIN_BARIS_MAKS);
  const nPengecualian = pelanggan.filter((p) => p.terminHari !== null).length;
  const nYatim = pelanggan.filter((p) => !p.diMaster).length;
  const bawaan = terminUnit === null ? "belum diatur" : `${terminUnit.terminHari} hari`;

  return (
    <>
      {!bolehAtur && (
        <div className="banner info keu-banner" role="status" data-termin-baca-saja>
          <b>Hanya baca</b>
          <p className="keu-p">{pesanTakBoleh}</p>
        </div>
      )}

      <section className="card card-pad-lg mt6" aria-labelledby="termin-bawaan">
        <div className="section-h">
          <h2 id="termin-bawaan" className="text-h3">
            Termin bawaan {namaUnit}
          </h2>
          <span className="fs16 t-tertiary">berlaku untuk semua pelanggan tanpa pengecualian</span>
        </div>
        <div className="mt4" data-termin-unit>
          <div className="tutup-angka num">{terminUnit === null ? "Belum diatur" : `${terminUnit.terminHari} hari`}</div>
          <div className="fs16 t-tertiary">
            {terminUnit === null
              ? "Faktur tanpa jatuh tempo EasyMax yang sah dan tanpa pengecualian pelanggan tampil sebagai “Termin belum diatur” dan tidak dihitung lewat jatuh tempo."
              : `Diatur oleh ${siapaKapan(terminUnit.diaturOleh, terminUnit.diaturAt)}`}
          </div>
        </div>
        {bolehAtur && (
          <div className="keu-2col">
            <label className="keu-fld">
              <span className="keu-label">Termin bawaan (hari sesudah tanggal faktur)</span>
              <input
                className="manual-input num"
                type="number"
                name="terminUnit"
                inputMode="numeric"
                min={batas.min}
                max={batas.maks}
                step={1}
                value={isiUnit}
                onChange={(e) => setIsiUnit(e.target.value)}
                placeholder={rentang}
              />
              {isiUnit.trim() !== "" && nilaiUnit === null && (
                <span className="fs16 t-danger">Isi bilangan bulat {rentang}.</span>
              )}
            </label>
            <div className="manual-form-actions">
              <button
                type="button"
                className="btn-navy"
                disabled={pending || nilaiUnit === null}
                onClick={() => {
                  if (nilaiUnit === null) return;
                  jalankan("unit", () => tetapkanTerminUnit({ code, terminHari: nilaiUnit }));
                }}
              >
                {pending ? "Menyimpan…" : "Simpan termin bawaan"}
              </button>
            </div>
          </div>
        )}
        <div className="mt2">{umpan("unit")}</div>
      </section>

      <section className="card card-pad-lg mt6" aria-labelledby="termin-pelanggan">
        <div className="section-h">
          <h2 id="termin-pelanggan" className="text-h3">
            Pengecualian per pelanggan
          </h2>
          <span className="fs16 t-tertiary">
            {nPengecualian} pengecualian · {pelanggan.length} pelanggan
          </span>
        </div>
        <p className="fs16 t-tertiary mt2">
          Pelanggan tanpa pengecualian memakai termin bawaan unit ({bawaan}). Perubahan langsung berlaku untuk
          semua faktur yang jatuh temponya tidak diisi di EasyMax, termasuk faktur lama yang masih terbuka.
        </p>
        {nYatim > 0 && (
          <div className="banner warning keu-banner" role="status" data-termin-yatim-ringkas>
            <b>{nYatim} pengecualian untuk pelanggan yang tidak ada lagi di master EasyMax</b>
            <p className="keu-p">
              Pengecualian itu tetap menggeser jatuh tempo faktur lama pelanggan tersebut. Periksa, lalu hapus
              bila sudah tidak diperlukan.
            </p>
          </div>
        )}

        <label className="keu-fld">
          <span className="keu-label">Cari pelanggan (nama atau kode)</span>
          <input
            className="manual-input"
            type="search"
            name="cariPelanggan"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="ketik nama atau kode"
          />
        </label>

        {pelanggan.length === 0 ? (
          <div className="empty-inline mt4">Belum ada pelanggan di master unit ini.</div>
        ) : cocok.length === 0 ? (
          <div className="empty-inline mt4">Tidak ada pelanggan yang cocok dengan “{cari.trim()}”.</div>
        ) : (
          <div className="tbl-scroll mt4">
            <div className="grid-head cols-akun">
              <span>Pelanggan</span>
              <span>Termin</span>
              <span>Sumber</span>
              <span>Diatur oleh</span>
              <span>{bolehAtur ? "Tindakan" : ""}</span>
            </div>
            {tampil.map((p) => {
              const terbuka = bolehAtur && buka === p.kodePelanggan;
              return (
                <div
                  className="grid-row cols-akun"
                  key={p.kodePelanggan}
                  data-termin-baris={p.kodePelanggan}
                  data-termin-yatim={p.diMaster ? undefined : ""}
                >
                  <span className="w600">
                    {p.namaPelanggan ?? "Nama tidak tersedia"}
                    {!p.diMaster && <span className="keu-pill">tidak ada di master</span>}
                    <span className="fs16 t-tertiary keu-p mono">{p.kodePelanggan}</span>
                  </span>
                  <span className="num">{p.terminHari === null ? bawaan : `${p.terminHari} hari`}</span>
                  <span className="fs16">
                    {p.terminHari === null ? <span className="t-tertiary">pakai bawaan unit</span> : "pengecualian"}
                  </span>
                  <span className="fs16 t-secondary">{siapaKapan(p.diaturOleh, p.diaturAt) ?? "—"}</span>
                  <span className="fs16">
                    {bolehAtur &&
                      (terbuka ? (
                        <span className="edc-slip-isi">
                          <input
                            className="manual-input num"
                            type="number"
                            name="terminPelanggan"
                            aria-label={`Termin ${p.namaPelanggan ?? p.kodePelanggan} dalam hari`}
                            inputMode="numeric"
                            min={batas.min}
                            max={batas.maks}
                            step={1}
                            value={isiPelanggan}
                            onChange={(e) => setIsiPelanggan(e.target.value)}
                            placeholder={rentang}
                          />
                          <button
                            type="button"
                            className="btn-tint sm"
                            disabled={pending || nilaiPelanggan === null}
                            onClick={() => {
                              if (nilaiPelanggan === null) return;
                              jalankan(
                                p.kodePelanggan,
                                () =>
                                  tetapkanTerminPelanggan({
                                    code,
                                    kodePelanggan: p.kodePelanggan,
                                    terminHari: nilaiPelanggan,
                                  }),
                                () => setBuka(null),
                              );
                            }}
                          >
                            {pending ? "Menyimpan…" : "Simpan"}
                          </button>
                          <button type="button" className="btn-outline sm" disabled={pending} onClick={() => setBuka(null)}>
                            Batal
                          </button>
                        </span>
                      ) : yakinHapus === p.kodePelanggan ? (
                        <span className="keu-yakin">
                          <button
                            type="button"
                            className="btn-outline sm t-danger"
                            disabled={pending}
                            onClick={() => {
                              setYakinHapus(null);
                              jalankan(p.kodePelanggan, () =>
                                hapusTerminPelanggan({ code, kodePelanggan: p.kodePelanggan }),
                              );
                            }}
                          >
                            Ya, hapus pengecualian
                          </button>
                          <button type="button" className="btn-outline sm" onClick={() => setYakinHapus(null)}>
                            Tidak
                          </button>
                        </span>
                      ) : (
                        <span className="edc-rek-aksi">
                          {/* Pelanggan yatim tak diberi termin baru — hanya bisa dihapus pengecualiannya. */}
                          {p.diMaster && (
                            <button
                              type="button"
                              className="btn-tint sm"
                              disabled={pending}
                              onClick={() => {
                                setBuka(p.kodePelanggan);
                                setYakinHapus(null);
                                setIsiPelanggan(p.terminHari === null ? "" : String(p.terminHari));
                                setSasaran(null);
                              }}
                            >
                              {p.terminHari === null ? "Atur pengecualian" : "Ubah"}
                            </button>
                          )}
                          {p.terminHari !== null && (
                            <button
                              type="button"
                              className="btn-outline sm"
                              disabled={pending}
                              onClick={() => {
                                setYakinHapus(p.kodePelanggan);
                                setBuka(null);
                              }}
                            >
                              Hapus pengecualian
                            </button>
                          )}
                        </span>
                      ))}
                    {terbuka && isiPelanggan.trim() !== "" && nilaiPelanggan === null && (
                      <span className="fs16 t-danger keu-p">Isi bilangan bulat {rentang}.</span>
                    )}
                    {umpan(p.kodePelanggan)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {cocok.length > tampil.length && (
          <p className="fs16 t-tertiary mt4" data-termin-terpotong>
            Menampilkan {tampil.length} dari {cocok.length} pelanggan — persempit dengan pencarian.
          </p>
        )}
      </section>
    </>
  );
}
