"use client";

import { useState, useTransition } from "react";
import { jelaskanButirTerbuka, type ButirDijelaskan } from "@/lib/tutup-bulan-actions";
import type { PenjelasanButir } from "@/lib/tutup-bulan-penjelasan";

/**
 * "Jelaskan butir terbuka" (rencana 2026-11-02 K6 U11; R32). Dirender HANYA
 * bagi staf Keuangan & HoF (`bolehMintaPenjelasan` dihitung di server) saat
 * vonis menolak. Penjelasan AI hanya SARAN: tak disimpan, tak mengubah vonis,
 * dan gagal-nya tidak menyembunyikan apa pun — daftar periksa di atas tetap
 * yang berlaku.
 *
 * Keadaan: memuat · gagal ("Penjelasan tidak tersedia — vonis tetap tampil") ·
 * usang (sidik butir saat dibuat ≠ `hashKini` vonis yang sedang tampil).
 */

type Hasil = { hash: string; dibuatAt: string; butir: ButirDijelaskan[]; tidakDijelaskan: number };

const jamWib = (iso: string): string =>
  new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

function Isi({ p }: { p: PenjelasanButir }) {
  return (
    <dl className="fs16 mt2">
      <dt className="w600">Apa yang beda</dt>
      <dd>{p.apaBeda}</dd>
      <dt className="w600">Kemungkinan sebab</dt>
      <dd>{p.kemungkinanSebab}</dd>
      <dt className="w600">Langkah disarankan</dt>
      <dd>{p.langkah}</dd>
    </dl>
  );
}

export function TutupBulanPenjelasan({ code, bulan, hashKini }: { code: string; bulan: string; hashKini: string }) {
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [gagal, setGagal] = useState<string | null>(null);
  const [memuat, start] = useTransition();

  const minta = (): void => {
    setGagal(null);
    start(async () => {
      const r = await jelaskanButirTerbuka({ code, bulan });
      if (!r.ok) {
        setHasil(null);
        setGagal(r.error);
      } else {
        setHasil({ hash: r.hash, dibuatAt: r.dibuatAt, butir: r.butir, tidakDijelaskan: r.tidakDijelaskan });
      }
    });
  };

  const usang = hasil !== null && hasil.hash !== hashKini;

  return (
    <section className="card card-pad-lg mt6" aria-labelledby="penjelasan-butir" aria-busy={memuat}>
      <h3 id="penjelasan-butir" className="text-h3">
        Penjelasan butir terbuka
      </h3>
      <p className="fs16 t-tertiary mt2">
        Penjelasan ditulis AI dari tanggal, nominal, dan keterangan bank — hanya saran. Vonis tutup bulan tetap dari aturan
        pasti di atas; AI tidak mencocokkan, memposting, atau menutup bulan.
      </p>
      <div className="manual-form-actions">
        <button type="button" className="btn-outline" onClick={minta} disabled={memuat}>
          {memuat ? "Memuat penjelasan…" : hasil === null ? "Jelaskan butir terbuka" : "Jelaskan ulang"}
        </button>
      </div>
      {gagal !== null && (
        <div className="banner warning keu-banner" role="status" data-keadaan="gagal">
          {gagal.startsWith("Penjelasan tidak tersedia") ? gagal : `Penjelasan tidak tersedia — vonis tetap tampil. ${gagal}`}
        </div>
      )}
      {usang && (
        <div className="banner warning keu-banner" role="status" data-keadaan="usang">
          Penjelasan ini usang — butir terbuka sudah berubah sejak dibuat pukul {jamWib(hasil.dibuatAt)} WIB. Muat ulang
          halaman bila perlu, lalu minta penjelasan ulang.
        </div>
      )}
      {hasil !== null && (
        <div className={usang ? "t-tertiary" : undefined} data-keadaan={usang ? "usang" : "segar"}>
          <p className="fs14 t-tertiary mt2">Dibuat pukul {jamWib(hasil.dibuatAt)} WIB.</p>
          {hasil.butir.length === 0 ? (
            <div className="empty-inline mt2">Tak ada butir terbuka untuk dijelaskan.</div>
          ) : (
            <ol className="mt2">
              {hasil.butir.map((b) => (
                <li key={b.id} className="mt4">
                  <div className="w600">{b.judul}</div>
                  {b.penjelasan ? <Isi p={b.penjelasan} /> : <div className="fs14 t-tertiary">Tak ada penjelasan untuk butir ini.</div>}
                </li>
              ))}
            </ol>
          )}
          {hasil.tidakDijelaskan > 0 && (
            <p className="fs14 t-tertiary mt2">{hasil.tidakDijelaskan} butir lainnya tidak dijelaskan — selesaikan yang di atas dulu.</p>
          )}
        </div>
      )}
    </section>
  );
}
