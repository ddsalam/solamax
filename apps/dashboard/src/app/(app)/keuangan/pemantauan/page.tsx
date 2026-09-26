import { notFound } from "next/navigation";
import { addDays, todayWib } from "@/lib/periods";
import { UnitDateFilters } from "@/components/UnitDateFilters";
import { unitDotted, unitLabel } from "@/lib/config";
import {
  LABEL_KEJADIAN,
  NADA_KEJADIAN,
  nadaTerburuk,
  rakitPantau,
  ringkasPelaku,
  type Nada,
} from "@/lib/keuangan-pantau-model";
import { getBahanPantau, JENDELA_PANTAU_HARI } from "@/lib/keuangan-pantau-queries";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { getDataScope } from "@/lib/scope";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * Pemantauan pemakaian keuangan. **READ-ONLY.**
 *
 * Menjawab pertanyaan pemilik, bukan pertanyaan akuntan: **apakah tim keuangan
 * benar-benar memakai modul ini, dan di mana pemakaiannya menyimpang?**
 * Papan keuangan menjawab "apakah pembukuan seimbang"; layar ini menjawab
 * "apakah pembukuannya DIKERJAKAN".
 *
 * ⛔ **Layar ini TIDAK menulis apa pun** — termasuk tidak membuat baris
 * `day_close`. Ia sengaja tidak menautkan ke Layar 4 (Tutup hari): membuka
 * Layar 4 melahirkan baris `day_close` (§10.15), dan pemantau yang meninggalkan
 * jejak di hal yang dipantaunya merusak ukurannya sendiri — hari yang "pernah
 * dibuka" oleh pemilik akan terbaca sebagai hari yang disentuh tim keuangan.
 *
 * Tanggal di pemilih adalah AKHIR jendela `JENDELA_PANTAU_HARI` hari. Bawaannya
 * KEMARIN, bukan hari ini: hari yang sedang berjalan belum selesai dijual,
 * jadi "belum dibukukan" untuk hari ini bukan kelalaian.
 */
export default async function PemantauanKeuanganPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string }>;
}) {
  const scope = await getDataScope();
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const sp = await searchParams;
  const kemarin = addDays(todayWib(), -1);
  const sampai = sp.tanggal && DATE_RE.test(sp.tanggal) ? sp.tanggal : kemarin;

  const bahan = await getBahanPantau(
    scope.units.map((u) => u.unit_id),
    sampai,
  );
  const baris = rakitPantau(
    scope.units.map((u) => u.unit_id),
    bahan,
  );
  const pelaku = ringkasPelaku(bahan.aktivitas);
  const namaUnit = new Map(scope.units.map((u) => [Number(u.unit_id), u] as const));

  const unitMerah = baris.filter((b) => b.merah > 0).length;
  const kejadianPenting = baris.flatMap((b) => b.kejadian).filter((k) => NADA_KEJADIAN[k.jenis] !== "hijau");
  const rp = (n: number | null): string =>
    n === null ? "—" : n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

  return (
    <>
      <UnitDateFilters
        units={scope.units.map((u) => ({ code: u.code, name: u.name, dotted: unitDotted(u.code) }))}
        code={scope.units[0]?.code ?? ""}
        segment="keuangan-pantau"
        dimensiUnit="tak_berlaku"
        date={sampai}
        today={todayWib()}
        maxDate={todayWib()}
      />
      <div className="section-h">
        <h1 className="text-h3 t-brand">Pemantauan pemakaian keuangan</h1>
      </div>
      <p className="fs16 t-tertiary mt2">
        {JENDELA_PANTAU_HARI} hari terakhir ({bahan.dari} s.d. {bahan.sampai}). Layar ini tidak menilai
        labanya — ia menilai apakah pembukuannya <strong>dikerjakan</strong>, dan di mana pengerjaannya
        menyimpang. Hanya baca: membukanya tidak mengubah apa pun.
      </p>

      <div className="kpi-grid mt6">
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Unit yang belum siap / lalai</div>
          <div className={`tutup-angka num ${unitMerah ? "t-danger" : ""}`}>
            {unitMerah} / {baris.length}
          </div>
          <div className="fs16 t-secondary">unit dengan sedikitnya satu temuan merah</div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Tanda kesalahan</div>
          <div className="tutup-angka num">{kejadianPenting.length}</div>
          <div className="fs16 t-secondary">pembatalan, pencatatan terlambat, selisih, pos janggal</div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Orang yang bekerja di modul</div>
          <div className="tutup-angka num">{pelaku.length}</div>
          <div className="fs16 t-secondary">
            {pelaku.length === 0
              ? "tidak ada satu pun tulisan keuangan dalam jendela ini"
              : "yang menulis sesuatu dalam jendela ini"}
          </div>
        </div>
      </div>

      <div className="section-h mt6">
        <h2 className="text-h3">Per unit — kesiapan & kedisiplinan</h2>
        <span className="fs16 t-tertiary">diurut dari yang paling perlu dilihat</span>
      </div>
      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-pantau">
          <span>SPBU</span>
          <span>Temuan</span>
        </div>
        {baris.map((b) => {
          const u = namaUnit.get(b.unitId);
          return (
            <div className="grid-row cols-pantau" key={b.unitId}>
              <span className="w600">
                {u ? (
                  <a href={`/keuangan/unit/${u.code}/${sampai}/input`}>
                    {u.name} <span className="meta">· {unitLabel(u.code)}</span>
                  </a>
                ) : (
                  `unit ${b.unitId}`
                )}
                <span className={`keu-chip nada-${nadaTerburuk(b.temuan)}`}>
                  {b.merah} merah · {b.kuning} kuning
                </span>
              </span>
              <span className="pantau-temuan">
                {b.temuan.map((t) => (
                  <span key={t.kode}>
                    <span className={`keu-chip nada-${t.nada}`}>{t.judul}</span>
                    {t.nada !== "hijau" && <span className="fs16 t-tertiary keu-p">{t.rinci}</span>}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <div className="section-h mt8">
        <h2 className="text-h3">Tanda kesalahan</h2>
        <span className="fs16 t-tertiary">petunjuk untuk diperiksa, bukan vonis — yang berarti adalah polanya</span>
      </div>
      {kejadianPenting.length === 0 ? (
        <p className="fs16 t-secondary">
          Tidak ada pembatalan, pencatatan terlambat, selisih, atau pos janggal dalam jendela ini.
          {pelaku.length === 0 && " (Wajar — belum ada yang menulis apa pun.)"}
        </p>
      ) : (
        <div className="card tbl-card tbl-scroll">
          <div className="grid-head cols-pantau-kejadian">
            <span>Waktu</span>
            <span>Kejadian</span>
            <span>SPBU</span>
            <span>Rincian</span>
            <span className="right">Nominal</span>
          </div>
          {kejadianPenting.slice(0, 150).map((k, i) => (
            <div className="grid-row cols-pantau-kejadian" key={`${k.jenis}-${k.waktu}-${i}`}>
              <span className="fs16 num">{k.waktu}</span>
              <span className="fs16">
                <span className={`keu-chip nada-${NADA_KEJADIAN[k.jenis] as Nada}`}>{LABEL_KEJADIAN[k.jenis]}</span>
                {k.hariTerlambat !== null && (
                  <span className="fs16 t-tertiary keu-p">{k.hariTerlambat} hari sesudah tanggal bisnisnya</span>
                )}
              </span>
              <span className="fs16">{namaUnit.get(k.unitId)?.name ?? k.unitId}</span>
              <span className="fs16 t-secondary">
                {k.tanggalBisnis && <span className="meta">tgl {k.tanggalBisnis} · </span>}
                {k.keterangan}
                {k.pelaku && <span className="meta"> · oleh {k.pelaku}</span>}
              </span>
              <span className="right num">{rp(k.nominal)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="section-h mt8">
        <h2 className="text-h3">Siapa mengerjakan apa</h2>
        <span className="fs16 t-tertiary">dari kolom pelaku tiap tabel — orang yang tak muncul di sini tidak menulis apa pun</span>
      </div>
      {pelaku.length === 0 ? (
        <div className="banner warning keu-banner" role="status">
          <b>Tidak ada satu pun pekerjaan keuangan tercatat dalam {JENDELA_PANTAU_HARI} hari ini</b>
          <p className="keu-p">
            Tak ada harga beli, mutasi kas, saldo pembuka, settlement EDC, tinjauan biaya, atau tutup hari
            yang ditulis siapa pun. Modulnya ada, tetapi belum dipakai.
          </p>
        </div>
      ) : (
        <div className="card tbl-card tbl-scroll">
          <div className="grid-head cols-pantau-pelaku">
            <span>Pengguna</span>
            <span className="right">Aksi</span>
            <span className="right">Pembatalan</span>
            <span>Rincian</span>
            <span>Terakhir</span>
          </div>
          {pelaku.map((p) => (
            <div className="grid-row cols-pantau-pelaku" key={p.userId}>
              <span className="fs16 w600">{p.label}</span>
              <span className="right num">{p.total}</span>
              <span className={`right num ${p.perhatian ? "t-danger" : ""}`}>
                {p.pembatalan}
                {p.porsiBatal !== null && (
                  <span className="meta"> ({Math.round(p.porsiBatal * 100)}%)</span>
                )}
              </span>
              <span className="fs16 t-secondary">
                {Object.entries(p.perJenis)
                  .map(([j, n]) => `${j} ${n}`)
                  .join(" · ")}
              </span>
              <span className="fs16 num">{p.terakhir}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
