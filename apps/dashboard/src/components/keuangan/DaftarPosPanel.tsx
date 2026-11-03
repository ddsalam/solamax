"use client";

import { useState, useTransition } from "react";
import { hapusSubPos, tambahSubPos, ubahPetaKategori } from "@/lib/pos-actions";
import {
  LABEL_JENIS,
  periksaHapusPos,
  periksaSubPosBaru,
  type KelasPos,
  type KelengkapanPeta,
  type Pos,
  type RujukanPos,
} from "@/lib/pos-model";

/**
 * Daftar Pos (rencana 2026-11-02 K6 U1; R1–R5).
 *
 * Tiga bagian: daftar pos per kelas (induk + sub-pos), tambah sub-pos (HoF),
 * dan peta kategori operasional → pos (HoF). Pemeriksaan di layar memakai
 * fungsi murni yang SAMA dengan server (`pos-model.ts`); server tetap yang
 * memutuskan.
 *
 * ⛔ Pos daftar resmi tidak punya tombol hapus — ia lahir dari migrasi. Sub-pos
 * bank juga tidak: ia mengikuti rekeningnya di Kelola akun kas.
 */

export interface PetaTampil {
  kategori: string;
  kodeTersimpan: string;
  /** Peta yang berlaku masih berkode lama (sebelum rilis 0056 di unit ini). */
  kodeLama: boolean;
  pos: { kode: string; nama: string } | null;
}

type Pilihan = { kode: string; nama: string };

function Tanda({ p }: { p: Pos }) {
  const t: string[] = [];
  if (p.induk) t.push("induk");
  if (p.sistem) t.push("sistem");
  if (p.kliring) t.push("kliring");
  if (p.pengurang) t.push("pengurang");
  if (p.cashAccountId !== null) t.push("rekening bank");
  else if (p.unitId !== null) t.push("sub-pos unit");
  return (
    <>
      {t.map((x) => (
        <span key={x} className="keu-chip keadaan-belum">
          {x}
        </span>
      ))}
    </>
  );
}

export function DaftarPosPanel({
  code,
  hariIni,
  kelas,
  peta,
  kelengkapan,
  rujukan,
  posBeban,
  indukPilihan,
  bolehKelola,
}: {
  code: string;
  hariIni: string;
  kelas: KelasPos[];
  peta: PetaTampil[];
  kelengkapan: KelengkapanPeta;
  rujukan: Record<string, RujukanPos>;
  posBeban: Pilihan[];
  indukPilihan: Pilihan[];
  bolehKelola: boolean;
}) {
  const [induk, setInduk] = useState(indukPilihan[0]?.kode ?? "");
  const [kode, setKode] = useState("");
  const [nama, setNama] = useState("");
  const [petaBaru, setPetaBaru] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const daftar: Pos[] = kelas.flatMap((k) => k.baris.flatMap((b) => [b.pos, ...b.anak]));
  const salahSub = kode.trim() === "" ? null : periksaSubPosBaru({ kodeInduk: induk, kode, nama }, daftar);
  const kategoriPerPos = new Map<string, number>();
  for (const p of peta) if (p.pos) kategoriPerPos.set(p.pos.kode, (kategoriPerPos.get(p.pos.kode) ?? 0) + 1);
  const masalahPeta = [
    ...kelengkapan.tanpaPos.map((k) => `${k}: belum punya pos`),
    ...kelengkapan.ganda.map((k) => `${k}: lebih dari satu pos`),
    ...kelengkapan.bukanBeban.map((k) => `${k}: pos bukan beban`),
    ...kelengkapan.tidakBolehJurnal.map((k) => `${k}: pos induk`),
  ];

  const jalankan = (fn: () => Promise<{ ok: boolean; error?: string; pesan?: string }>, sesudah?: () => void): void => {
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

  const barisPos = (p: Pos, anak: boolean) => {
    const cekHapus = p.unitId !== null ? periksaHapusPos(p, rujukan[p.kode] ?? { peta: 0, jurnal: 0, saldoAwal: 0 }) : null;
    const nKategori = kategoriPerPos.get(p.kode) ?? 0;
    return (
      <tr key={`${p.unitId ?? "g"}-${p.kode}`}>
        <td className={`num ${anak ? "" : "w600"}`}>
          {anak ? "   " : ""}
          {p.kode}
        </td>
        <td className={anak ? "" : "w600"}>{p.nama}</td>
        <td className="t-secondary">{LABEL_JENIS[p.jenis]}</td>
        <td>
          <Tanda p={p} />
          {nKategori > 0 && <span className="t-tertiary"> {nKategori} kategori dipetakan</span>}
        </td>
        {bolehKelola && (
          <td>
            {p.unitId !== null && p.cashAccountId === null && p.id !== null && (
              <button
                type="button"
                className="btn-outline sm"
                disabled={pending || cekHapus !== null}
                title={cekHapus ?? undefined}
                onClick={() => {
                  const id = p.id!;
                  jalankan(() => hapusSubPos({ code, id }));
                }}
              >
                Hapus
              </button>
            )}
          </td>
        )}
      </tr>
    );
  };

  return (
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

      <section aria-labelledby="daftar-pos">
        <div className="section-h">
          <h2 id="daftar-pos" className="text-h3">
            Pos
          </h2>
          <span className="fs16 t-tertiary">
            {bolehKelola ? "pos induk tidak dipakai jurnal — jurnal memakai sub-posnya" : "hanya Head of Finance yang bisa mengubah"}
          </span>
        </div>
        <div className="tbl-scroll mt4">
          <table className="fs16">
            <thead>
              <tr>
                <th className="left">Kode</th>
                <th className="left">Pos</th>
                <th className="left">Jenis</th>
                <th className="left">Keterangan</th>
                {bolehKelola && <th />}
              </tr>
            </thead>
            {kelas.map((k) => (
              <tbody key={k.kelas}>
                <tr>
                  <td className="w600 t-secondary">{k.kelas}</td>
                  <td className="w600 t-secondary" colSpan={bolehKelola ? 4 : 3}>
                    {k.label}
                  </td>
                </tr>
                {k.baris.flatMap((b) => [barisPos(b.pos, false), ...b.anak.map((a) => barisPos(a, true))])}
              </tbody>
            ))}
          </table>
        </div>
      </section>

      {bolehKelola && (
        <section aria-labelledby="tambah-sub-pos" className="mt6">
          <div className="section-h">
            <h2 id="tambah-sub-pos" className="text-h3">
              Tambah sub-pos
            </h2>
            <span className="fs16 t-tertiary">milik unit ini saja · sub-pos bank lahir dari Kelola akun kas</span>
          </div>
          <div className="keu-2col mt4">
            <label className="keu-fld">
              <span className="keu-label">Di bawah pos induk</span>
              <select className="manual-input" value={induk} onChange={(e) => setInduk(e.target.value)}>
                {indukPilihan.map((p) => (
                  <option key={p.kode} value={p.kode}>
                    {p.kode} {p.nama}
                  </option>
                ))}
              </select>
            </label>
            <label className="keu-fld">
              <span className="keu-label">Kode (empat digit)</span>
              <input className="manual-input" value={kode} onChange={(e) => setKode(e.target.value)} inputMode="numeric" />
            </label>
            <label className="keu-fld">
              <span className="keu-label">Nama sub-pos</span>
              <input className="manual-input" value={nama} onChange={(e) => setNama(e.target.value)} />
            </label>
            <div className="manual-form-actions">
              <button
                type="button"
                className="btn-navy sm"
                disabled={pending || kode.trim() === "" || salahSub !== null}
                onClick={() =>
                  jalankan(
                    () => tambahSubPos({ code, kodeInduk: induk, kode, nama }),
                    () => {
                      setKode("");
                      setNama("");
                    },
                  )
                }
              >
                Tambah sub-pos
              </button>
            </div>
          </div>
          {salahSub !== null && <p className="fs16 t-tertiary mt2">{salahSub}</p>}
        </section>
      )}

      <section aria-labelledby="peta-kategori" className="mt6">
        <div className="section-h">
          <h2 id="peta-kategori" className="text-h3">
            Peta kategori → pos
          </h2>
          <span className="fs16 t-tertiary">
            berlaku untuk semua unit · perubahan berlaku mulai hari ini ({hariIni}); baris yang sudah tersimpan tidak
            berubah
          </span>
        </div>
        {masalahPeta.length > 0 && (
          <div className="banner danger keu-banner" role="alert">
            Peta belum lengkap: {masalahPeta.join("; ")}.
          </div>
        )}
        <div className="tbl-scroll mt4">
          <table className="fs16">
            <thead>
              <tr>
                <th className="left">Kategori operasional</th>
                <th className="left">Pos</th>
                {bolehKelola && <th className="left">Ubah ke</th>}
              </tr>
            </thead>
            <tbody>
              {peta.map((p) => {
                const pilih = petaBaru[p.kategori] ?? p.pos?.kode ?? "";
                return (
                  <tr key={p.kategori}>
                    <td>{p.kategori}</td>
                    <td>
                      {p.pos === null ? (
                        <span className="t-tertiary">{p.kodeTersimpan} — tidak dikenal</span>
                      ) : (
                        <>
                          {p.pos.kode} {p.pos.nama}
                          {p.kodeLama && <span className="t-tertiary"> (tersimpan sebagai kode lama {p.kodeTersimpan})</span>}
                        </>
                      )}
                    </td>
                    {bolehKelola && (
                      <td>
                        <select
                          className="manual-input"
                          value={pilih}
                          aria-label={`Pos baru untuk ${p.kategori}`}
                          onChange={(e) => setPetaBaru((s) => ({ ...s, [p.kategori]: e.target.value }))}
                        >
                          {posBeban.map((b) => (
                            <option key={b.kode} value={b.kode}>
                              {b.kode} {b.nama}
                            </option>
                          ))}
                        </select>{" "}
                        <button
                          type="button"
                          className="btn-outline sm"
                          disabled={pending || pilih === "" || (pilih === p.pos?.kode && !p.kodeLama)}
                          onClick={() => jalankan(() => ubahPetaKategori({ code, kategori: p.kategori, kodePos: pilih }))}
                        >
                          Simpan
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
