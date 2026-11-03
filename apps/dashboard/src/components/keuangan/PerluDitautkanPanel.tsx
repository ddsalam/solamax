"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { lengkapiBebanMutasi } from "@/lib/kas-actions";
import { butuhKategoriOperasional } from "@/lib/keuangan-kas-model";
import { KATEGORI_OPERASIONAL } from "@/lib/klasifikasi-model";
import { tautkanBebanKeMutasi } from "@/lib/tautan-actions";
import { kandidatMutasi, kosong, type PerluDitautkan } from "@/lib/tautan-model";

/**
 * Daftar "perlu ditautkan" (rencana K6 U3; R27) — seksi di halaman Biaya.
 *
 * Tiga jenis baris separuh-tercatat, SATU tindakan per jenis:
 *   (a) mutasi biaya tanpa baris Biaya → pilih jenis biaya, lengkapi;
 *   (b) baris Biaya pintu Finance tanpa mutasi → pilih mutasi kandidat;
 *   (c) Pembelian BBM bank tanpa penebusan → buka halaman Penebusan SO.
 *
 * ⛔ TIDAK ADA TEBAKAN: kandidat (b) hanya disaring (nominal sama, ±3 hari,
 * kategori sejalan, belum bertaut). Kandidat tunggal pun tetap harus dipilih.
 */

const rp = (n: number): string =>
  n.toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const BULAN_TUTUP = "bulan sudah ditutup — koreksi lewat jurnal memorial Head of Finance";

export function PerluDitautkanPanel({
  code,
  daftar,
  peta,
  bolehTulis,
}: {
  code: string;
  daftar: PerluDitautkan;
  /** Peta kategori operasional → pos, untuk keterangan "akan tercatat di pos …". */
  peta: { category: string; account: string }[];
  bolehTulis: boolean;
}) {
  const router = useRouter();
  const [jenis, setJenis] = useState<Record<string, string>>({});
  const [pilihKas, setPilihKas] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const posDari = (k: string): string | null => peta.find((p) => p.category === k)?.account ?? null;

  const lengkapi = (id: string, label: string | null): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await lengkapiBebanMutasi({
        code,
        cashLedgerId: id,
        operationalCategory: butuhKategoriOperasional(label) ? (jenis[id] ?? "") : null,
      });
      if (!res.ok) setErr(res.error);
      else {
        setMsg(`Baris Biaya tercatat${res.hariBuku ? ` di hari buku ${res.hariBuku}` : ""} dan bertaut ke mutasinya.`);
        router.refresh();
      }
    });
  };

  const tautkan = (manualEntryId: string): void => {
    setErr(null);
    setMsg(null);
    const cashLedgerId = pilihKas[manualEntryId] ?? "";
    start(async () => {
      const res = await tautkanBebanKeMutasi({ code, manualEntryId, cashLedgerId });
      if (!res.ok) setErr(res.error);
      else {
        setMsg("Baris Biaya kini bertaut ke mutasi yang dipilih.");
        router.refresh();
      }
    });
  };

  return (
    <section aria-labelledby="blok-tautan">
      <div className="section-h">
        <h3 id="blok-tautan" className="text-h3">
          Perlu ditautkan
        </h3>
        <span className="fs16 t-tertiary">Sejak saldo pembuka · sistem tidak menebak tautannya</span>
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

      {kosong(daftar) ? (
        <div className="card empty-inline">Tidak ada yang perlu ditautkan.</div>
      ) : (
        <>
          {daftar.mutasiTanpaBiaya.length > 0 && (
            <div className="card tbl-card tbl-scroll">
              <div className="grid-head cols-buku ro">
                <span>Mutasi tanpa baris Biaya</span>
                <span>Kategori</span>
                <span className="right">Nominal</span>
                <span>Tindakan</span>
              </div>
              {daftar.mutasiTanpaBiaya.map((k) => {
                const butuh = butuhKategoriOperasional(k.categoryLabel);
                const pilihan = jenis[k.id] ?? "";
                return (
                  <div className="grid-row cols-buku ro" key={k.id}>
                    <span className="w600">
                      {k.keterangan}
                      <span className="keu-p t-tertiary">
                        {k.businessDate} · {k.namaAkun}
                      </span>
                    </span>
                    <span className="fs16 t-secondary">{k.categoryLabel}</span>
                    <span className={`right num ${k.amount < 0 ? "t-danger" : ""}`}>{rp(k.amount)}</span>
                    <span className="fs16">
                      {k.bulanTertutup ? (
                        <span className="t-tertiary">{BULAN_TUTUP}</span>
                      ) : !bolehTulis ? (
                        <span className="t-tertiary">dilengkapi staf Keuangan</span>
                      ) : (
                        <span className="keu-yakin">
                          {butuh && (
                            <select
                              className="manual-input"
                              aria-label="Jenis biaya"
                              value={pilihan}
                              onChange={(e) => setJenis((j) => ({ ...j, [k.id]: e.target.value }))}
                            >
                              <option value="">— pilih jenis biaya —</option>
                              {KATEGORI_OPERASIONAL.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                  {posDari(o) ? ` · pos ${posDari(o)}` : ""}
                                </option>
                              ))}
                            </select>
                          )}
                          <button
                            type="button"
                            className="btn-outline sm"
                            disabled={pending || (butuh && pilihan === "")}
                            onClick={() => lengkapi(k.id, k.categoryLabel)}
                          >
                            Lengkapi baris Biaya
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {daftar.biayaTanpaMutasi.length > 0 && (
            <div className="card tbl-card tbl-scroll mt6">
              <div className="grid-head cols-buku ro">
                <span>Baris Biaya Finance tanpa mutasi</span>
                <span>Kategori operasional</span>
                <span className="right">Nominal</span>
                <span>Tindakan</span>
              </div>
              {daftar.biayaTanpaMutasi.map((b) => {
                const calon = kandidatMutasi(b, daftar.mutasiTanpaBiaya);
                const terpilih = pilihKas[b.id] ?? "";
                return (
                  <div className="grid-row cols-buku ro" key={b.id}>
                    <span className="w600">
                      {b.keterangan}
                      <span className="keu-p t-tertiary">
                        {b.businessDate} · {b.section === "pendapatan_lain" ? "pendapatan lain-lain" : "biaya"}
                      </span>
                    </span>
                    <span className="fs16 t-secondary">{b.operationalCategory ?? "—"}</span>
                    <span className="right num">{rp(b.amount)}</span>
                    <span className="fs16">
                      {b.bulanTertutup ? (
                        <span className="t-tertiary">{BULAN_TUTUP}</span>
                      ) : b.hariTertutup ? (
                        <span className="t-tertiary">hari bukunya sudah tutup hari — baris terkunci</span>
                      ) : calon.length === 0 ? (
                        <span className="t-tertiary">
                          Belum ada mutasi dengan nominal sama (±3 hari) — catat mutasinya di buku kas/bank lebih
                          dulu.
                        </span>
                      ) : !bolehTulis ? (
                        <span className="t-tertiary">{calon.length} mutasi kandidat · ditautkan staf Keuangan</span>
                      ) : (
                        <span className="keu-yakin">
                          <select
                            className="manual-input"
                            aria-label="Mutasi kandidat"
                            value={terpilih}
                            onChange={(e) => setPilihKas((p) => ({ ...p, [b.id]: e.target.value }))}
                          >
                            <option value="">— pilih mutasi —</option>
                            {calon.map((k) => (
                              <option key={k.id} value={k.id}>
                                {k.businessDate} · {k.namaAkun} · {k.keterangan}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn-outline sm"
                            disabled={pending || terpilih === ""}
                            onClick={() => tautkan(b.id)}
                          >
                            Tautkan
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {daftar.bbmTanpaPenebusan.length > 0 && (
            <div className="card tbl-card tbl-scroll mt6">
              <div className="grid-head cols-buku ro">
                <span>Pembelian BBM tanpa penebusan</span>
                <span>Rekening</span>
                <span className="right">Nominal</span>
                <span>Tindakan</span>
              </div>
              {daftar.bbmTanpaPenebusan.map((k) => (
                <div className="grid-row cols-buku ro" key={k.id}>
                  <span className="w600">
                    {k.keterangan}
                    <span className="keu-p t-tertiary">{k.businessDate}</span>
                  </span>
                  <span className="fs16 t-secondary">{k.namaAkun}</span>
                  <span className="right num t-danger">{rp(k.amount)}</span>
                  <span className="fs16">
                    {k.bulanTertutup ? (
                      <span className="t-tertiary">{BULAN_TUTUP}</span>
                    ) : (
                      <a href={`/keuangan/unit/${code}/penebusan`}>Lengkapi di Penebusan SO</a>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
