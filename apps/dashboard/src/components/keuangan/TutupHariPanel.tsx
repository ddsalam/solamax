"use client";

import { useState, useTransition } from "react";
import { tutupHari } from "@/lib/tutup-hari-actions";
import type { KelengkapanInput, OverrideRow } from "@/lib/keuangan-input-queries";
import {
  BATAS_HOF_RP,
  TOLERANSI_RP,
  tierFor,
  type Tier,
} from "@/lib/keuangan-tutup-hari";

/**
 * Layar 4 — gerbang tutup hari (mockup layar 4).
 *
 * Inilah satu-satunya layar yang benar-benar baru: spreadsheet bisa menghitung
 * angka pemeriksa, ia tidak bisa **menolak hari berikutnya**.
 *
 * ⛔ **Ambang TIDAK diketik ulang di sini** — `TOLERANSI_RP`, `BATAS_HOF_RP`,
 * dan `tierFor()` diambil dari `keuangan-tutup-hari.ts`, yang juga dipakai
 * server action dan dicerminkan CHECK di 0026. Angka yang hidup di dua tempat
 * akan berselisih.
 *
 * ⛔ **Selisih ditampilkan apa adanya** — tidak dibulatkan, tidak dinolkan,
 * termasuk yang ≤ Rp 10.000. Eksepsi bukan pemaafan: selisih yang ditutup lewat
 * eksepsi tetap berdiri sebagai angka dengan reason code-nya.
 */

const rp = (n: number): string => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

const LABEL_TIER: Record<Tier, string> = {
  within_tolerance: "Dalam toleransi — penutupan biasa",
  exception_hof: "Eksepsi — wewenang Head of Finance",
  override_direksi: "Override — hanya Direksi",
};

export function TutupHariPanel({
  code,
  date,
  langkahHarian,
  cashFlowCheck,
  kelengkapan,
  reasonCodes,
  overrides,
  sudahDitutup,
  bolehMenutupTier,
}: {
  code: string;
  date: string;
  /** LANGKAH harian BSCheck — yang dinilai gerbang. `null` = tak terhitung. */
  langkahHarian: number | null;
  cashFlowCheck: number | null;
  kelengkapan: KelengkapanInput;
  reasonCodes: { code: string; label: string; requiresTarget: boolean }[];
  overrides: OverrideRow[];
  sudahDitutup: boolean;
  /** Hasil `bolehMenutup(tier, ctx)` dari server — layar tidak menghitungnya. */
  bolehMenutupTier: boolean;
}) {
  const [kode, setKode] = useState("");
  const [target, setTarget] = useState("");
  const [setuju, setSetuju] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tier = langkahHarian === null ? null : tierFor(langkahHarian);
  const rc = reasonCodes.find((r) => r.code === kode) ?? null;
  const butuhTarget = rc?.requiresTarget === true;

  const syaratKurang: string[] = [];
  if (!kelengkapan.hargaBeliLengkap) {
    syaratKurang.push(`${kelengkapan.produkTanpaHarga} produk belum punya harga beli`);
  }
  if (!kelengkapan.adaAkunKas) syaratKurang.push("belum ada akun kas");
  if (kelengkapan.settlementBelumCair > 0) {
    syaratKurang.push(`${kelengkapan.settlementBelumCair} settlement EDC belum disetujui`);
  }
  if (kelengkapan.biayaMenungguTinjauan > 0) {
    syaratKurang.push(`${kelengkapan.biayaMenungguTinjauan} baris biaya menunggu tinjauan`);
  }

  const tutup = (): void => {
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await tutupHari({
        code,
        date,
        reasonCode: kode === "" ? null : kode,
        targetDate: target === "" ? null : target,
        setujui: setuju,
      });
      if (!res.ok) setErr(res.error);
      else setMsg(`Hari ditutup pada tingkat: ${LABEL_TIER[res.tier as Tier]}.`);
    });
  };

  return (
    <section aria-labelledby="tutup-hari">
      <div className="section-h">
        <h2 id="tutup-hari" className="text-h3">
          Tutup hari
        </h2>
        <span className="fs16 t-tertiary">
          Neraca dan buku besar harus seimbang di angka Rp 0
        </span>
      </div>
      <p className="fs16 t-secondary mt2">
        Untuk kebutuhan operasional ada eksepsi bertingkat — tetapi setiap selisih tetap
        tercatat dengan <em>reason code</em>, tidak pernah diabaikan.
      </p>

      {/* Tiga syarat penutupan sebagai KEADAAN, bukan angka telanjang. */}
      <div className="tutup3 mt4">
        <Syarat
          judul="Cash flow check"
          nilai={cashFlowCheck}
          baik={cashFlowCheck === 0}
          catatan={
            cashFlowCheck === null
              ? "Belum bisa dihitung — buku kas belum lengkap."
              : cashFlowCheck === 0
                ? "Terpenuhi"
                : "Arus tidak cocok dengan saldo buku."
          }
        />
        <Syarat
          judul="Balance sheet check — langkah harian"
          nilai={langkahHarian}
          baik={langkahHarian === 0}
          catatan={
            langkahHarian === null
              ? "Belum bisa dihitung — butuh total asset kemarin."
              : tier === null
                ? ""
                : LABEL_TIER[tier]
          }
        />
        <Syarat
          judul="Kelengkapan input"
          nilai={null}
          baik={syaratKurang.length === 0}
          catatan={
            syaratKurang.length === 0 ? "Semua blok terisi & disahkan" : syaratKurang.join(" · ")
          }
          teks={syaratKurang.length === 0 ? "Lengkap" : `${syaratKurang.length} belum`}
        />
      </div>

      {/* ⚠️ Kejujuran yang diminta: kumulatif belum tersedia, dan itu disebut. */}
      <div className="banner info keu-banner" role="status">
        <b>Yang dinilai gerbang adalah LANGKAH HARIAN</b>
        <p className="keu-p">
          Nilai <em>Balance sheet check</em> kumulatif belum tersedia — saldo pembuka ekuitas
          hidup di workbook dan impor riwayat belum dikerjakan. Itu <strong>tidak</strong>
          menghalangi gerbang ini: yang dinilai memang selisih terhadap kemarin, dan itu bisa
          dihitung tanpa nilai kumulatifnya.
        </p>
      </div>

      {/* Tangga toleransi — ambangnya DIBAWA dari aturan, bukan diketik ulang. */}
      <div className="section-h mt6">
        <h3 className="text-h3">Tangga toleransi</h3>
        <span className="fs16 t-tertiary">berlaku per hari per outlet</span>
      </div>
      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-tangga">
          <span>Selisih</span>
          <span>Siapa boleh menutup</span>
          <span>Syarat</span>
          <span>Jejak</span>
        </div>
        <BarisTangga
          batas="Rp 0"
          siapa="Finance"
          syarat="Tidak ada — tutup normal"
          jejak="Penutupan biasa"
          aktif={tier === "within_tolerance" && langkahHarian === 0}
        />
        <BarisTangga
          batas={`s.d. ${rp(TOLERANSI_RP)}`}
          siapa="Finance"
          syarat="Reason code wajib"
          jejak="Selisih tercatat, tidak dinolkan"
          aktif={tier === "within_tolerance" && langkahHarian !== 0}
        />
        <BarisTangga
          batas={`${rp(TOLERANSI_RP + 1)} – ${rp(BATAS_HOF_RP)}`}
          siapa="Head of Finance"
          syarat="Alasan tertulis + bukti pendukung"
          jejak="Exception close · ditandai di papan"
          aktif={tier === "exception_hof"}
        />
        <BarisTangga
          batas={`Di atas ${rp(BATAS_HOF_RP)}`}
          siapa="Direksi"
          syarat="Override eksplisit + bukti"
          jejak="Ditandai permanen, masuk laporan bulanan"
          aktif={tier === "override_direksi"}
        />
      </div>

      <div className="banner warning keu-banner" role="status">
        <b>Eksepsi bukan pemaafan</b>
        <p className="keu-p">
          Selisih yang ditutup lewat eksepsi tetap berdiri sebagai angka dengan reason
          code-nya, bukan dibulatkan hilang. Kalau reason code yang sama muncul berulang, itu
          sinyal proses yang rusak — bukan toleransi yang perlu dinaikkan.
        </p>
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

      {sudahDitutup ? (
        <div className="banner info keu-banner" role="status">
          <b>Hari ini sudah ditutup</b>
          <p className="keu-p">
            Transaksi aslinya beku bagi pengawas maupun Finance. Yang salah setelah penutupan
            diperbaiki lewat Koreksi / balik — entri baru bertaut, transaksi asli tetap utuh.
          </p>
        </div>
      ) : (
        <div className="card card-pad-lg keu-form">
          <h3 className="text-h3">Tutup hari ini</h3>
          {langkahHarian === null ? (
            <p className="fs16 t-tertiary mt2">
              Belum bisa ditutup: langkah harian belum terhitung, dan menutup hari yang belum
              dinilai adalah menutup mata, bukan menutup buku.
            </p>
          ) : (
            <>
              <p className="fs16 t-secondary mt2">
                Selisih hari ini <strong className="num">{rp(langkahHarian)}</strong> —{" "}
                {tier === null ? "" : LABEL_TIER[tier]}.
              </p>
              {langkahHarian !== 0 && (
                <label className="keu-fld">
                  <span className="keu-label">Kode alasan (wajib)</span>
                  <select className="manual-input" value={kode} onChange={(e) => setKode(e.target.value)}>
                    <option value="">— pilih kode —</option>
                    {reasonCodes.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.code} — {r.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {butuhTarget && (
                <label className="keu-fld">
                  <span className="keu-label">Tanggal target penyelesaian (wajib untuk kode ini)</span>
                  <input
                    className="manual-input"
                    type="date"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </label>
              )}
              {tier !== null && tier !== "within_tolerance" && (
                <label className="keu-attest">
                  <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} />
                  <span>
                    Saya menyetujui penutupan di luar toleransi ini, dan selisihnya tetap berdiri
                    tercatat sampai diselesaikan.
                  </span>
                </label>
              )}
              {!bolehMenutupTier && (
                <div className="banner danger keu-banner" role="status">
                  Selisih sebesar ini di luar wewenang Anda. {tier === "override_direksi"
                    ? "Hanya Direksi yang bisa memberi override."
                    : "Perlu Head of Finance."}
                </div>
              )}
              <div className="manual-form-actions">
                <button
                  type="button"
                  className="btn-navy"
                  onClick={tutup}
                  disabled={pending || !bolehMenutupTier}
                >
                  {pending ? "Menutup…" : "Tutup hari"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Riwayat override backdate (§2.3b) — siapa mengajukan, menyetujui, kapan dikonsumsi. */}
      <div className="section-h mt8">
        <h3 className="text-h3">Riwayat override backdate</h3>
        <span className="fs16 t-tertiary">jalur tembus satu-kali untuk hari yang sudah ditutup</span>
      </div>
      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-override">
          <span>Kode &amp; alasan</span>
          <span>Diajukan</span>
          <span>Disetujui</span>
          <span>Dikonsumsi</span>
        </div>
        {overrides.length === 0 ? (
          <div className="empty-inline">
            Belum pernah ada override backdate untuk tanggal ini — dan itu keadaan yang sehat.
          </div>
        ) : (
          overrides.map((o) => (
            <div className="grid-row cols-override" key={o.id}>
              <span className="w600">
                {o.reasonCode}
                <span className="fs16 t-tertiary"> · {o.alasan}</span>
                {o.void && <span className="keu-pill">dibatalkan</span>}
              </span>
              <span className="fs16 t-secondary">{o.requestedBy ?? "—"}</span>
              <span className="fs16 t-secondary">
                {o.approvedBy ?? <span className="t-tertiary">belum</span>}
                {o.approvedAt !== null && <span className="fs16 t-tertiary"> · {o.approvedAt}</span>}
              </span>
              <span className="fs16 t-secondary">
                {o.consumedAt ?? <span className="t-tertiary">belum dipakai</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Syarat({
  judul,
  nilai,
  baik,
  catatan,
  teks,
}: {
  judul: string;
  nilai: number | null;
  baik: boolean;
  catatan: string;
  teks?: string;
}) {
  const nada = nilai === null && teks === undefined ? "tak_terhitung" : baik ? "baik" : "buruk";
  return (
    <div className={`card card-pad tutup-syarat ${nada}`}>
      <div className="fs16 t-tertiary">{judul}</div>
      <div className="tutup-angka num">
        {teks ?? (nilai === null ? "belum bisa dihitung" : rp(nilai))}
      </div>
      <div className="fs16 t-secondary">{catatan}</div>
    </div>
  );
}

function BarisTangga({
  batas,
  siapa,
  syarat,
  jejak,
  aktif,
}: {
  batas: string;
  siapa: string;
  syarat: string;
  jejak: string;
  aktif: boolean;
}) {
  return (
    <div className={`grid-row cols-tangga${aktif ? " tangga-aktif" : ""}`}>
      <span className="w600">
        {batas}
        {aktif && <span className="keu-pill">hari ini di sini</span>}
      </span>
      <span className="fs16">{siapa}</span>
      <span className="fs16 t-secondary">{syarat}</span>
      <span className="fs16 t-tertiary">{jejak}</span>
    </div>
  );
}
