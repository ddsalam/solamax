import type { BarisMaju, BarisParkirTampil } from "@/lib/tutup-bulan-queries";

/**
 * Layar 4 — dua daftar yang dibuka-tutup (rencana 2026-10-29 U12; R24, R32):
 *
 *   1. baris yang DIBUKUKAN MAJU ke hari ini (tanggal asal lebih awal) — sumber
 *      koreksi susulan, tertaut ke kode alasan dan baris sumbernya;
 *   2. baris yang MASIH DIPARKIR di penampung (dibukukan s.d. hari ini).
 *
 * Murni tampilan (tanpa state) supaya bisa dirender di server dan diuji
 * dengan `renderToStaticMarkup`. Penampung TIDAK menahan tutup hari (R24) —
 * ia wajib nol sebelum tutup BULAN, dan itu disebut di sini.
 */

const rp = (sen: number): string => (sen / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });

export function TutupHariSusulan({
  code,
  date,
  maju,
  parkir,
  koreksiSusulan,
}: {
  code: string;
  date: string;
  maju: BarisMaju[];
  parkir: BarisParkirTampil[];
  /** Rupiah; `null` = belum terhitung. */
  koreksiSusulan: number | null;
}) {
  const sigmaParkir = parkir.reduce((s, p) => s + p.amountSen, 0);
  const bulan = date.slice(0, 7);
  return (
    <section aria-labelledby="tutup-hari-susulan" className="mt6">
      <div className="section-h">
        <h3 id="tutup-hari-susulan" className="text-h3">
          Baris maju &amp; penampung
        </h3>
        <span className="fs16 t-tertiary">tidak ikut dinilai tangga toleransi</span>
      </div>

      <details className="card card-pad mt2" open={maju.length > 0} data-daftar="maju">
        <summary className="w600">
          Dibukukan maju ke hari ini · {maju.length} baris · koreksi susulan{" "}
          <span className="num">{koreksiSusulan === null ? "belum bisa dihitung" : rp(Math.round(koreksiSusulan * 100))}</span>
        </summary>
        {maju.length === 0 ? (
          <p className="fs16 t-tertiary mt2">Tak ada baris bertanggal asal sebelum hari ini yang dibukukan ke hari ini.</p>
        ) : (
          <div className="tbl-scroll mt2">
            <div className="grid-head cols-susulan">
              <span>Tanggal asal</span>
              <span>Rekening · keterangan</span>
              <span>Nominal</span>
              <span>Kode alasan</span>
              <span>Sumber</span>
            </div>
            {maju.map((m) => (
              <div className="grid-row cols-susulan" key={m.id}>
                <span className="num">{m.tanggalAsal}</span>
                <span className="fs16">
                  {m.rekening}
                  <span className="t-tertiary"> · {m.keterangan}</span>
                  {m.categoryLabel !== null && <span className="keu-pill">{m.categoryLabel}</span>}
                </span>
                <span className="num">{rp(m.amountSen)}</span>
                <span className="fs16">
                  {m.alasanMaju ?? "—"}
                  {m.alasanLabel !== null && <span className="t-tertiary"> · {m.alasanLabel}</span>}
                </span>
                <span className="fs16">
                  {m.bulanBank !== null ? (
                    <a href={`/keuangan/unit/${code}/impor-bank/${m.bulanBank}`}>baris rekening koran {m.bulanBank}</a>
                  ) : m.pasanganUuid !== null ? (
                    <a href={`/keuangan/unit/${code}/pihak-lawan`}>pasangan antar unit</a>
                  ) : (
                    <span className="t-tertiary">entri buku kas</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="fs16 t-secondary mt2">
          Koreksi susulan = pengaruh baris-baris ini terhadap langkah neraca hari ini. Ia ditampilkan terpisah dan
          tidak ikut dalam selisih yang dinilai, supaya selisih asli hari ini tidak tersembunyi di dalamnya.
        </p>
      </details>

      <details className="card card-pad mt2" open={parkir.length > 0} data-daftar="parkir">
        <summary className="w600">
          Masih diparkir di penampung · {parkir.length} baris · <span className="num">{rp(sigmaParkir)}</span>
        </summary>
        {parkir.length === 0 ? (
          <p className="fs16 t-tertiary mt2">Penampung kosong s.d. hari ini.</p>
        ) : (
          <div className="tbl-scroll mt2">
            <div className="grid-head cols-susulan">
              <span>Tanggal bank</span>
              <span>Rekening · keterangan</span>
              <span>Nominal</span>
              <span>Hari buku</span>
              <span>Selesaikan</span>
            </div>
            {parkir.map((p) => (
              <div className="grid-row cols-susulan" key={p.id}>
                <span className="num">{p.tanggalBank}</span>
                <span className="fs16">
                  {p.rekening}
                  <span className="t-tertiary"> · {p.keterangan}</span>
                </span>
                <span className="num">{rp(p.amountSen)}</span>
                <span className="num">{p.businessDate}</span>
                <span className="fs16">
                  <a href={`/keuangan/unit/${code}/impor-bank/${p.tanggalBank.slice(0, 7)}`}>pindahkan dari penampung</a>
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="fs16 t-secondary mt2">
          Penampung tidak menahan tutup hari. Ia wajib nol sebelum{" "}
          <a href={`/keuangan/unit/${code}/tutup-bulan/${bulan}`}>tutup bulan</a>.
        </p>
      </details>
    </section>
  );
}
