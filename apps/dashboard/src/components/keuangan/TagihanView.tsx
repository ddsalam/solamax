import { rp } from "@/lib/format";
import { TAGIHAN_PAGE_SIZE } from "@/lib/tagihan-model";
import {
  BATAS_BARIS_TAGIHAN,
  type BelumDitagihkanDaftar,
  type BelumDitagihkanDokumen,
  type TagihanDaftar,
  type TagihanKesiapanSiap,
  type TagihanUbin,
} from "@/lib/tagihan-queries";
import {
  TAGIHAN_TAMPILAN,
  tagihanBukaHref,
  tagihanExportHref,
  tagihanFilterHref,
  tagihanKesegaranLabel,
  tagihanPageHref,
  tagihanPelangganHref,
  tagihanTampilanHref,
  tagihanTampilanLabel,
  tagihanTerminHref,
  type TagihanTampilan,
  type TagihanView as TagihanTampilanView,
} from "@/lib/tagihan-route";
import {
  TagihanBelumTersedia,
  TagihanCocokSaldo,
  TagihanFakturTabel,
  tanggalTagihan,
} from "./TagihanTabel";

/**
 * S1 Daftar tagihan per SPBU dan S3 Belum ditagihkan (rencana 2026-11-13 U7).
 * Komponen server murni: seluruh keadaan datang dari URL lewat `view`, dan
 * setiap kontrol adalah tautan atau formulir GET — tanpa JavaScript klien.
 */

interface Umum {
  unit: { code: string; name: string };
  /** Tampilan yang sudah dinormalkan dari URL. */
  view: TagihanTampilanView;
  /** Tanggal bisnis WIB yang dipakai menghitung status. */
  hariIni: string;
}

export type TagihanViewProps =
  | (Umum & { state: "belum_tersedia" })
  | (Umum & { state: "faktur"; data: TagihanDaftar })
  | (Umum & {
      state: "belum_ditagihkan";
      data: BelumDitagihkanDaftar;
      /** Dokumen kelompok yang dibuka lewat `buka`; `null` = tak ada yang dibuka. */
      dokumenBuka: { dokumen: BelumDitagihkanDokumen[]; terpotong: boolean } | null;
    });

type Siap = Exclude<TagihanViewProps, { state: "belum_tersedia" }>;

const KOSONG: Record<TagihanTampilan, string> = {
  perlu_tindakan: "Tidak ada faktur yang perlu tindakan",
  lewat_jatuh_tempo: "Tidak ada faktur lewat jatuh tempo",
  sebagian: "Tidak ada faktur yang dibayar sebagian",
  lebih_bayar: "Tidak ada faktur lebih bayar",
  lunas: "Tidak ada faktur lunas pada periode ini",
  belum_ditagihkan: "Tidak ada penjualan kredit yang belum ditagihkan",
};

/** Teks keadaan kosong per saringan; pencarian aktif disebut supaya kosongnya tidak disalahbaca. */
export function tagihanKosongLabel(tampilan: TagihanTampilan, cari: string): string {
  return cari ? `${KOSONG[tampilan]} untuk pencarian “${cari}”` : KOSONG[tampilan];
}

const faktur = (n: number): string => `${n.toLocaleString("id-ID")} faktur`;

function Ubin({ unitCode, ubin, aktif }: { unitCode: string; ubin: TagihanUbin; aktif: TagihanTampilan }) {
  // Dua ubin tengah tak punya saringan sendiri: keduanya bagian dari "Perlu tindakan".
  const daftar: Array<{ judul: string; nilai: number; catatan: string; tampilan: TagihanTampilan; nada: string }> = [
    { judul: "Lewat jatuh tempo", nilai: ubin.lewatJatuhTempo.sisa, catatan: faktur(ubin.lewatJatuhTempo.jumlah),
      tampilan: "lewat_jatuh_tempo", nada: "danger" },
    { judul: "Belum jatuh tempo", nilai: ubin.belumJatuhTempo.sisa, catatan: faktur(ubin.belumJatuhTempo.jumlah),
      tampilan: "perlu_tindakan", nada: "neutral" },
    { judul: "Termin belum diatur", nilai: ubin.terminBelumDiatur.sisa, catatan: faktur(ubin.terminBelumDiatur.jumlah),
      tampilan: "perlu_tindakan", nada: "warning" },
    { judul: "Belum ditagihkan", nilai: ubin.belumDitagihkan.total,
      catatan: `${ubin.belumDitagihkan.jumlahDokumen.toLocaleString("id-ID")} dokumen · ${ubin.belumDitagihkan.jumlahPelanggan.toLocaleString("id-ID")} pelanggan`,
      tampilan: "belum_ditagihkan", nada: "info" },
  ];
  return (
    <section className="tagihan-ubin" aria-label="Ringkasan tagihan">
      {daftar.map((u) => (
        <a
          key={u.judul}
          className={`card tagihan-ubin-kartu ${u.nada}${u.tampilan === aktif && u.tampilan !== "perlu_tindakan" ? " aktif" : ""}`}
          href={tagihanTampilanHref(unitCode, u.tampilan)}
        >
          <span className="tagihan-ubin-judul">{u.judul}</span>
          <strong className="num">{rp(u.nilai)}</strong>
          <span className="tagihan-ubin-catatan">{u.catatan}</span>
        </a>
      ))}
    </section>
  );
}

function Kontrol({ unitCode, view }: { unitCode: string; view: TagihanTampilanView }) {
  const periodeDitulis = view.tampilan === "lunas" && !view.periodeBawaan;
  return (
    <div className="tagihan-kontrol no-print" aria-label="Saring dan cari tagihan">
      <nav className="seg tagihan-saring" aria-label="Saringan tagihan">
        {TAGIHAN_TAMPILAN.map((tampilan) => (
          <a
            key={tampilan}
            href={tagihanFilterHref(unitCode, view, tampilan)}
            className={`seg-btn${view.tampilan === tampilan ? " active" : ""}`}
            aria-current={view.tampilan === tampilan ? "page" : undefined}
          >
            {tagihanTampilanLabel(tampilan)}
          </a>
        ))}
      </nav>

      <form method="get" className="b6-piutang-search">
        <input type="hidden" name="filter" value={view.tampilan} />
        {periodeDitulis && <input type="hidden" name="from" value={view.periode.from} />}
        {periodeDitulis && <input type="hidden" name="to" value={view.periode.to} />}
        <label htmlFor="tagihan-q">Cari kode atau nama pelanggan</label>
        <div>
          <input id="tagihan-q" name="q" type="search" defaultValue={view.search} />
          <button type="submit" className="btn-outline">Cari</button>
        </div>
      </form>

      {view.tampilan === "lunas" && (
        <form method="get" className="tagihan-periode">
          <input type="hidden" name="filter" value="lunas" />
          {view.search && <input type="hidden" name="q" value={view.search} />}
          <div>
            <label htmlFor="tagihan-from">Dilunasi dari</label>
            <input id="tagihan-from" name="from" type="date" defaultValue={view.periode.from} required />
          </div>
          <div>
            <label htmlFor="tagihan-to">sampai</label>
            <input id="tagihan-to" name="to" type="date" defaultValue={view.periode.to} required />
          </div>
          <button type="submit" className="btn-outline">Terapkan</button>
        </form>
      )}
    </div>
  );
}

function Halaman({ unitCode, view, page, totalPages }: {
  unitCode: string;
  view: TagihanTampilanView;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="b6-piutang-pagination tagihan-halaman no-print" aria-label="Halaman daftar tagihan">
      {page > 1
        ? <a className="btn-outline" rel="prev" href={tagihanPageHref(unitCode, view, page - 1)}>← Sebelumnya</a>
        : <span />}
      <span>Halaman {page} dari {totalPages}</span>
      {page < totalPages
        ? <a className="btn-outline" rel="next" href={tagihanPageHref(unitCode, view, page + 1)}>Berikutnya →</a>
        : <span />}
    </nav>
  );
}

function DaftarFaktur({ props }: { props: Extract<TagihanViewProps, { state: "faktur" }> }) {
  const { unit, view, data } = props;
  const { halaman } = data;
  const judul = tagihanTampilanLabel(view.tampilan);
  return (
    <section className="card b6-piutang-list" aria-labelledby="tagihan-daftar-judul">
      <div className="b6-piutang-list-meta">
        <div>
          <h2 id="tagihan-daftar-judul">{judul}</h2>
          <p>
            {faktur(halaman.resultCount)} · {TAGIHAN_PAGE_SIZE} per halaman · urut hari lewat terbanyak, lalu jatuh tempo terdekat
            {data.periodeLunas && ` · dilunasi ${tanggalTagihan(data.periodeLunas.from)} – ${tanggalTagihan(data.periodeLunas.to)}`}
          </p>
        </div>
      </div>
      {halaman.rows.length === 0 ? (
        <div className="empty-inline b6-piutang-empty">{tagihanKosongLabel(view.tampilan, data.cari)}.</div>
      ) : (
        <TagihanFakturTabel unitCode={unit.code} baris={halaman.rows} label={`Daftar faktur — ${judul}`} />
      )}
      <Halaman unitCode={unit.code} view={view} page={halaman.page} totalPages={halaman.totalPages} />
    </section>
  );
}

function DaftarBelumDitagihkan({ props }: { props: Extract<TagihanViewProps, { state: "belum_ditagihkan" }> }) {
  const { unit, view, data, dokumenBuka, hariIni } = props;
  // Halaman pelanggan dibuka pada tanggal Saldo pelanggan yang dipakai membandingkan.
  const tanggalSaldo = data.saldoPerTanggal ?? hariIni;
  return (
    <section className="card b6-piutang-list" aria-labelledby="tagihan-daftar-judul">
      <div className="b6-piutang-list-meta">
        <div>
          <h2 id="tagihan-daftar-judul">Belum ditagihkan</h2>
          <p>
            {data.kelompok.length.toLocaleString("id-ID")} pelanggan · penjualan kredit yang belum masuk faktur mana pun, dokumen tertua dulu
          </p>
        </div>
      </div>
      {data.saldoSedangDiperbarui && (
        <p className="tagihan-catatan">
          Saldo pelanggan per {tanggalTagihan(data.saldoPerTanggal)} sedang diperbarui; saldo piutang dan selisih di bawah bisa berubah.
        </p>
      )}
      {data.kelompok.length === 0 ? (
        <div className="empty-inline b6-piutang-empty">{tagihanKosongLabel("belum_ditagihkan", data.cari)}.</div>
      ) : (
        <div className="tagihan-kelompok-daftar">
          {data.kelompok.map((k) => {
            const terbuka = view.buka === k.customerCode;
            return (
              <article className={`tagihan-kelompok${terbuka ? " terbuka" : ""}`} key={k.customerCode}>
                <header>
                  <div className="tagihan-kelompok-nama">
                    <a href={tagihanPelangganHref(unit.code, tanggalSaldo, k.customerCode)}>
                      {k.namaPelanggan?.trim() || "Nama belum tersedia"}
                    </a>
                    <span className="tagihan-sub mono">{k.customerCode}</span>
                  </div>
                  <dl className="tagihan-kelompok-angka">
                    <div><dt>Dokumen</dt><dd className="num">{k.jumlahDokumen.toLocaleString("id-ID")}</dd></div>
                    <div><dt>Total</dt><dd className="num w600">{rp(k.total)}</dd></div>
                    <div><dt>Dokumen tertua</dt><dd className="num">{tanggalTagihan(k.tanggalTertua)}</dd></div>
                  </dl>
                  <a
                    className="btn-outline no-print"
                    href={tagihanBukaHref(unit.code, view, terbuka ? null : k.customerCode)}
                    aria-expanded={terbuka}
                  >
                    {terbuka ? "Tutup dokumen" : "Lihat dokumen"}
                  </a>
                </header>
                <TagihanCocokSaldo cocok={k.cocokSaldo} />
                {terbuka && dokumenBuka && (
                  <>
                    {dokumenBuka.terpotong && (
                      <p className="tagihan-catatan">
                        Hanya {BATAS_BARIS_TAGIHAN.toLocaleString("id-ID")} dokumen pertama yang ditampilkan.
                      </p>
                    )}
                    <div className="tbl-scroll">
                      <table className="tagihan-tbl" aria-label={`Dokumen belum ditagihkan ${k.customerCode}`}>
                        <thead>
                          <tr>
                            <th scope="col">No. dokumen</th>
                            <th scope="col">Tanggal</th>
                            <th scope="col">Keterangan</th>
                            <th scope="col" className="right">Jumlah</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dokumenBuka.dokumen.map((d) => (
                            <tr key={d.kodeDokumen}>
                              <td className="mono">{d.kodeDokumen}</td>
                              <td className="num">{tanggalTagihan(d.tanggal)}</td>
                              <td>{d.keterangan?.trim() || "—"}</td>
                              <td className="right num">{rp(d.jumlah)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Spanduk({ unitCode, kesiapanData }: {
  unitCode: string;
  kesiapanData: { ubin: TagihanUbin; terpotong: boolean };
}) {
  const tanpaTermin = kesiapanData.ubin.terminBelumDiatur;
  return (
    <>
      {kesiapanData.terpotong && (
        <div className="banner warning" role="alert">
          <span className="dot warning" aria-hidden="true" />
          <div>
            <strong>Daftar terpotong — angka di layar ini tidak lengkap</strong>
            <p className="keu-p">
              Faktur SPBU ini melebihi {BATAS_BARIS_TAGIHAN.toLocaleString("id-ID")} baris. Ubin, daftar, dan ekspor hanya memuat sebagian; jangan dipakai sebagai total.
            </p>
          </div>
        </div>
      )}
      {tanpaTermin.jumlah > 0 && (
        <div className="banner info" role="status">
          <span className="dot info" aria-hidden="true" />
          <div>
            <strong>{faktur(tanpaTermin.jumlah)} belum punya termin ({rp(tanpaTermin.sisa)})</strong>
            <p className="keu-p">
              Tanpa termin, faktur ini tidak pernah dihitung lewat jatuh tempo — bukan berarti belum jatuh tempo.{" "}
              <a href={tagihanTerminHref(unitCode)}>Atur termin pembayaran</a>
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function kesiapan(props: TagihanViewProps): TagihanKesiapanSiap | null {
  return props.state === "belum_tersedia" ? null : props.data.kesiapan;
}

export function TagihanView(props: TagihanViewProps) {
  const { unit, view } = props;
  const siap = kesiapan(props);
  return (
    <div className="b6-piutang-page">
      <header className="b6-piutang-heading">
        <div>
          <div className="text-eyebrow t-tertiary">Keuangan · Tagihan pelanggan</div>
          <h1 className="text-h3 t-brand">Tagihan pelanggan</h1>
          <p>SPBU {unit.code} · {unit.name}</p>
          {siap && <p className="tagihan-kesegaran">{tagihanKesegaranLabel(siap.selesaiAt)}</p>}
        </div>
        <div className="b6-piutang-exports no-print" aria-label="Tindakan daftar tagihan">
          <a className="btn-outline" href={tagihanTerminHref(unit.code)}>Atur termin</a>
          {siap && <a className="btn-outline" href={tagihanExportHref(unit.code, view)}>Ekspor CSV</a>}
        </div>
      </header>

      {props.state === "belum_tersedia" ? (
        <TagihanBelumTersedia unit={unit} />
      ) : (
        <Isi props={props} />
      )}
    </div>
  );
}

function Isi({ props }: { props: Siap }) {
  const { unit, view, data } = props;
  return (
    <>
      <Spanduk unitCode={unit.code} kesiapanData={data} />
      <Ubin unitCode={unit.code} ubin={data.ubin} aktif={view.tampilan} />
      <Kontrol unitCode={unit.code} view={view} />
      {props.state === "faktur" ? <DaftarFaktur props={props} /> : <DaftarBelumDitagihkan props={props} />}
    </>
  );
}
