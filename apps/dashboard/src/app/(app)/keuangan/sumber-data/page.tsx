import { notFound } from "next/navigation";
import { unitLabel } from "@/lib/config";
import { qScoped } from "@/lib/db";
import { getKelengkapanInput } from "@/lib/keuangan-input-queries";
import { getDoHarian } from "@/lib/queries";
import { PENJELASAN_KOSONG } from "@/lib/keuangan-laporan-model";
import {
  daftarMasukan,
  LABEL_CARA,
  LABEL_KEADAAN,
  ringkasSumber,
  type FaktaSumber,
} from "@/lib/keuangan-sumber-model";
import { canViewLaporanKeuangan } from "@/lib/keuangan-wewenang";
import { getDataScope, type ScopedUnitId } from "@/lib/scope";
import { getSelection } from "@/lib/selection";
import { DATE_RE } from "@/lib/selection-keys";

export const dynamic = "force-dynamic";

/**
 * LAYAR 5 — Sumber data (mockup layar 5). **READ-ONLY.**
 *
 * Menjawab: **dari mana tiap angka datang.** Statusnya dihitung dari data hari
 * itu, bukan disalin dari janji mockup — "siap" yang tak pernah bisa berbunyi
 * "belum" bukan status, ia hiasan.
 *
 * ⚠️ **DUA KOREKSI TERHADAP MOCKUP, disebut di layarnya sendiri:**
 *
 * 1. Mockup menulis harga beli "Dijaga: tak boleh > harga jual". Sudah tidak
 *    berlaku — P1 adalah **peringatan wajib-diakui** (§4.1); reject keras akan
 *    memblokir 336 hari yang sah di Bakau.
 * 2. Mockup menutup dengan pertanyaan terbuka: *"apakah bagan akun dibuat
 *    seragam untuk tujuh unit"*. **Sudah terjawab** oleh migrasi 0023: default
 *    seragam (`unit_id NULL`) dengan override per-unit yang WAJIB beralasan
 *    (`override_reason`). Pertanyaan yang sudah terjawab tetapi masih terpampang
 *    akan ditanyakan ulang oleh orang berikutnya.
 */
export default async function SumberDataPage({
  searchParams,
}: {
  searchParams: Promise<{ tanggal?: string; unit?: string }>;
}) {
  const scope = await getDataScope();
  if (!canViewLaporanKeuangan({ role: scope.role, email: scope.email })) notFound();

  const sp = await searchParams;
  const seleksi = getSelection(scope.units);
  const date = sp.tanggal && DATE_RE.test(sp.tanggal) ? sp.tanggal : seleksi.date;
  const unit = scope.units.find((u) => u.code === (sp.unit ?? seleksi.unitCode)) ?? scope.units[0];
  if (unit === undefined) notFound();

  const fakta = await getFakta(unit.unit_id, date);
  const masukan = daftarMasukan(fakta);
  const r = ringkasSumber(masukan);

  return (
    <>
      <h1 className="text-h3 t-brand">Sumber data</h1>
      <div className="fs16 t-secondary mt2">
        {unit.name} · {unitLabel(unit.code)} — {date}
      </div>
      <p className="fs16 t-tertiary mt2">
        Setiap masukan workbook, dan dari mana SolaMax mengisinya. Statusnya dihitung dari data
        tanggal ini — bukan daftar janji.
      </p>

      <div className="kpi-grid mt6">
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Otomatis</div>
          <div className="tutup-angka num">
            {r.perCara.otomatis} / {r.total}
          </div>
          <div className="fs16 t-secondary">ditarik SolaMax dari EasyMax</div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Diketik tim keuangan</div>
          <div className="tutup-angka num">{r.perCara.input_keuangan}</div>
          <div className="fs16 t-secondary">
            ditambah {r.perCara.campuran} campuran — pengawas mengisi, Finance mengklasifikasi
          </div>
        </div>
        <div className="card card-pad">
          <div className="fs16 t-tertiary">Belum ada / berbatas</div>
          <div className="tutup-angka num">
            {r.belum} / {r.berbatas}
          </div>
          <div className="fs16 t-secondary">yang belum bersumber · yang batasnya diketahui</div>
        </div>
      </div>

      <div className="card tbl-card tbl-scroll mt6">
        <div className="grid-head cols-sumber">
          <span>Masukan</span>
          <span>Sumber di SolaMax</span>
          <span>Cara</span>
          <span>Keadaan</span>
        </div>
        {masukan.map((m) => (
          <div className="grid-row cols-sumber" key={m.sheet}>
            <span className="w600">{m.sheet}</span>
            <span className="fs16 t-secondary">{m.sumber}</span>
            <span className="fs16">{LABEL_CARA[m.cara]}</span>
            <span className="fs16">
              <span className={`keu-chip keadaan-${m.keadaan}`}>{LABEL_KEADAAN[m.keadaan]}</span>
              <span className="fs16 t-tertiary keu-p">{m.catatan}</span>
              {m.sebab !== undefined && (
                <span className="fs16 t-tertiary keu-p">{PENJELASAN_KOSONG[m.sebab]}</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Dua koreksi terhadap acuan — disebut di layarnya, bukan hanya di README. */}
      <div className="banner warning keu-banner" role="status">
        <b>Dua hal di mockup Layar 5 yang sudah tidak berlaku</b>
        <ul className="keu-list">
          <li>
            Mockup menulis harga beli <em>&quot;ditolak bila di atas harga jual&quot;</em>. Yang
            berlaku adalah <strong>peringatan wajib-diakui</strong> (§4.1) — penolakan keras akan
            memblokir 336 hari yang secara operasional sah di Bakau.
          </li>
          <li>
            Mockup menutup dengan pertanyaan <em>&quot;apakah bagan akun seragam untuk tujuh
            unit&quot;</em>. <strong>Sudah terjawab</strong> migrasi 0023: default seragam, dengan
            override per-unit yang wajib beralasan.
          </li>
        </ul>
      </div>

      <div className="section-h mt8">
        <h2 className="text-h3">Dua daftar yang tidak boleh dicampur</h2>
        <span className="fs16 t-tertiary">sheet &quot;List&quot; dipecah jadi dua master</span>
      </div>
      <div className="card tbl-card tbl-scroll">
        <div className="grid-head cols-master">
          <span>Master</span>
          <span>Pemilik</span>
          <span>Dipakai di</span>
        </div>
        <div className="grid-row cols-master">
          <span className="w600">Kategori operasional</span>
          <span className="fs16">Pengawas memilih</span>
          <span className="fs16 t-secondary">Rincian Penjualan — 14 kategori, daftar tertutup</span>
        </div>
        <div className="grid-row cols-master">
          <span className="w600">Bagan akun (CoA)</span>
          <span className="fs16">Finance memelihara</span>
          <span className="fs16 t-secondary">Buku besar &amp; laporan</span>
        </div>
        <div className="grid-row cols-master">
          <span className="w600">Pemetaan kategori → CoA</span>
          <span className="fs16">Finance</span>
          <span className="fs16 t-secondary">
            Otomatis saat transaksi masuk; bisa direklasifikasi per transaksi, teraudit
          </span>
        </div>
        <div className="grid-row cols-master">
          <span className="w600">Reason code selisih penutupan</span>
          <span className="fs16">Master baru</span>
          <span className="fs16 t-secondary">
            Daftar tertutup sejak awal — teks bebas membuat pola berulangnya tak pernah terlihat
          </span>
        </div>
      </div>
    </>
  );
}

/** Fakta hidup untuk menilai keadaan tiap masukan. */
async function getFakta(unit: ScopedUnitId, date: string): Promise<FaktaSumber> {
  const [kelengkapan, produk, opname, jual, biaya, sisaSo] = await Promise.all([
    getKelengkapanInput(unit, date),
    qScoped<{ n: number }>(unit, `SELECT count(*)::int AS n FROM product WHERE unit_id = $1`, [unit]),
    qScoped<{ n: number }>(
      unit,
      `SELECT count(*)::int AS n FROM opname
        WHERE unit_id = $1 AND COALESCE(dtaglopn, (dtgljam AT TIME ZONE 'Asia/Jakarta')::date) = $2::date`,
      [unit, date],
    ),
    qScoped<{ n: number }>(
      unit,
      `SELECT count(*)::int AS n FROM sales_header WHERE unit_id = $1 AND dtgljual = $2::date`,
      [unit, date],
    ),
    qScoped<{ pengawas: number; finance: number }>(
      unit,
      `SELECT count(*) FILTER (WHERE source_door = 'pengawas')::int AS pengawas,
              count(*) FILTER (WHERE source_door = 'finance')::int  AS finance
         FROM app.manual_entry
        WHERE unit_id = $1 AND business_date = $2::date AND NOT void
          AND section = 'pengeluaran'`,
      [unit, date],
    ),
    // Produk yang tak punya data SO hari itu — dari `getDoHarian`, kueri yang
    // sudah teruji. Percobaan pertama saya memakai tabel `so_header` yang TIDAK
    // ADA (data SO hidup di `tebus_*`); itu akan jatuh 42P01 saat dijalankan,
    // dan penjaga sintaks SQL tak bisa menangkapnya — ia parser, bukan eksekutor.
    getDoHarian(unit, date),
  ]);

  const nProduk = produk[0]?.n ?? 0;
  const berSisaSo = new Set(sisaSo.map((d) => d.ckdbbm));
  return {
    produk: nProduk,
    produkBerhargaBeli: Math.max(0, nProduk - kelengkapan.produkTanpaHarga),
    akunKas: kelengkapan.adaAkunKas ? 7 : 0,
    adaOpname: (opname[0]?.n ?? 0) > 0,
    adaPenjualan: (jual[0]?.n ?? 0) > 0,
    barisBiayaPengawas: biaya[0]?.pengawas ?? 0,
    barisBiayaFinance: biaya[0]?.finance ?? 0,
    settlementHariIni: kelengkapan.settlementBelumCair,
    produkTanpaSisaSo: Math.max(0, nProduk - berSisaSo.size),
  };
}
