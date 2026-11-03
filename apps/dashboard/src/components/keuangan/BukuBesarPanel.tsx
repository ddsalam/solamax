import type { BarisPos, BarisTemuan, LaporanBukuBesar } from "@/lib/buku-besar-laporan-model";
import { rpSen } from "@/lib/buku-besar-memorial-model";
import { tautanTemuan, type TemuanPembentukan } from "@/lib/buku-besar-temuan";
import type { JurnalTampil, KeadaanBukuBesar } from "@/lib/buku-besar-queries";
import { BentukUlangTombol, KoreksiMajuTombol, MemorialForm, MemorialTombol, SaldoAwalForm, type PosIsian } from "./BukuBesarAksi";

/**
 * Halaman Buku Besar per unit × bulan (rencana 2026-11-02 K6 U9; R8–R10, R12,
 * KTD10, KTD11). Komponen SERVER: menerima laporan yang sudah disusun
 * `susunLaporan` dan wewenang yang sudah dihitung halaman; formulir dan tombol
 * di `BukuBesarAksi.tsx`.
 *
 * Tata letak (U9 Approach): spanduk "sementara" → tab Neraca, Laba-rugi,
 * Temuan beda, Saldo awal, Jurnal memorial. Klik pos → daftar jurnal → tautan
 * ke catatan sumber.
 */

export const TAB_BUKU_BESAR = ["neraca", "laba-rugi", "temuan-jurnal", "temuan", "saldo-awal", "memorial"] as const;
export type TabBukuBesar = (typeof TAB_BUKU_BESAR)[number];

const LABEL_TAB: Record<TabBukuBesar, string> = {
  neraca: "Neraca",
  "laba-rugi": "Laba-rugi",
  "temuan-jurnal": "Temuan jurnal",
  temuan: "Temuan beda",
  "saldo-awal": "Saldo awal",
  memorial: "Jurnal memorial",
};

const LABEL_STATUS: Record<JurnalTampil["status"], string> = { aktif: "aktif", menunggu: "menunggu persetujuan", batal: "batal" };
const LABEL_JENIS: Record<JurnalTampil["jenis"], string> = { sumber: "sumber", koreksi: "koreksi maju", memorial: "memorial", saldo_awal: "saldo awal" };

export interface WewenangBukuBesar {
  userId: number;
  bolehSetujui: boolean;
  bolehUsul: boolean;
  bolehSaldoAwal: boolean;
  bolehBentukUlang: boolean;
}

export interface BukuBesarPanelProps {
  code: string;
  bulan: string;
  tab: TabBukuBesar;
  pos: string | null;
  lap: LaporanBukuBesar;
  keadaan: KeadaanBukuBesar;
  wewenang: WewenangBukuBesar;
  /** Rentang "Bentuk ulang bulan ini" — `null` = tak ada hari yang bisa dibentuk. */
  rentangBentuk: { dari: string; sampai: string } | null;
  jurnalPos: { jurnal: JurnalTampil[]; terpotong: boolean } | null;
  temuan: { batas: string; baris: BarisTemuan[] } | null;
  /** Tab "Temuan jurnal" — null bila tab lain. */
  temuanJurnal: TemuanPembentukan | null;
  memorial: JurnalTampil[] | null;
  saldoAwal: {
    isian: PosIsian[];
    kas: { kode: string; nama: string; saldoSen: number }[];
    tersimpan: { kode: string; nama: string; saldoSen: number; sumber: string }[];
    rekening: { nama: string; posKode: string | null; saldoSen: number | null; sementara: boolean }[];
  } | null;
  pilihanPos: { kode: string; nama: string }[];
  tanggalMemorial: string;
}

const href = (code: string, bulan: string, q: Record<string, string>) =>
  `/keuangan/unit/${code}/buku-besar/${bulan}?${new URLSearchParams(q).toString()}`;

/** Tautan ke catatan sumber jurnal — cukup ke layar harian yang memuatnya. */
function tautanSumber(code: string, bulan: string, j: JurnalTampil): { href: string; label: string } | null {
  if (j.jenis === "memorial") return { href: href(code, bulan, { tab: "memorial" }), label: "jurnal memorial" };
  switch (j.sumberTabel) {
    case "cash_ledger":
    case "manual_entry":
    case "edc_settlement":
      return { href: `/keuangan/unit/${code}/${j.tanggalBuku}/input`, label: "input harian" };
    case "easymax_produk":
    case "easymax_pelanggan":
      return { href: `/keuangan/unit/${code}/${j.tanggalEfektif}`, label: "laporan harian" };
    case "day_close":
      return { href: `/keuangan/unit/${code}/tutup-hari/${j.tanggalBuku}`, label: "tutup hari" };
    case "buku_besar_hari":
      return { href: `/keuangan/unit/${code}/tutup-hari/${j.tanggalEfektif}`, label: "hari asal" };
    default:
      return null;
  }
}

function BarisJurnalTabel({ j }: { j: JurnalTampil }) {
  return (
    <ul className="keu-list">
      {j.baris.map((b, i) => (
        <li key={i} className="num">
          {b.posKode} · {b.debetSen > 0 ? `D ${rpSen(b.debetSen)}` : `K ${rpSen(b.kreditSen)}`}
        </li>
      ))}
    </ul>
  );
}

function TabelPos({
  code,
  bulan,
  tab,
  judul,
  baris,
  total,
  pilih,
}: {
  code: string;
  bulan: string;
  tab: TabBukuBesar;
  judul: string;
  baris: BarisPos[];
  total: { label: string; nilaiSen: number };
  pilih: string | null;
}) {
  return (
    <div className="tbl-scroll mt4">
      <table className="fs16">
        <thead>
          <tr>
            <th className="left">{judul}</th>
            <th>Rp</th>
          </tr>
        </thead>
        <tbody>
          {baris.length === 0 && (
            <tr>
              <td className="t-tertiary" colSpan={2}>
                Tidak ada saldo.
              </td>
            </tr>
          )}
          {baris.map((b) => (
            <tr key={b.kode} aria-current={pilih === b.kode ? "true" : undefined}>
              <td>
                {b.kodeInduk ? "   " : ""}
                <a href={href(code, bulan, { tab, pos: b.kode })}>
                  {b.kode} {b.nama}
                </a>
              </td>
              <td className="num">{rpSen(b.nilaiSen)}</td>
            </tr>
          ))}
          <tr>
            <td className="w600">{total.label}</td>
            <td className="num w600">{rpSen(total.nilaiSen)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function DaftarJurnalPos({ code, bulan, pos, data }: { code: string; bulan: string; pos: string; data: { jurnal: JurnalTampil[]; terpotong: boolean } }) {
  return (
    <section aria-labelledby="jurnal-pos" className="mt6">
      <div className="section-h">
        <h2 id="jurnal-pos" className="text-h3">
          Jurnal pos {pos}
        </h2>
        <span className="fs16 t-tertiary">bertanggal efektif di bulan ini · semua status</span>
      </div>
      {data.terpotong && (
        <div className="banner warning keu-banner" role="status">
          Daftar terpotong — hanya jurnal pertama yang ditampilkan.
        </div>
      )}
      <div className="tbl-scroll mt4">
        <table className="fs16">
          <thead>
            <tr>
              <th className="left">Tanggal</th>
              <th className="left">Jurnal</th>
              <th className="left">Baris</th>
              <th className="left">Sumber</th>
            </tr>
          </thead>
          <tbody>
            {data.jurnal.length === 0 && (
              <tr>
                <td colSpan={4} className="t-tertiary">
                  Tidak ada jurnal bulan ini.
                </td>
              </tr>
            )}
            {data.jurnal.map((j) => {
              const s = tautanSumber(code, bulan, j);
              return (
                <tr key={j.id}>
                  <td className="num">
                    {j.tanggalEfektif}
                    {j.tanggalBuku !== j.tanggalEfektif && <span className="t-tertiary"> (dibukukan {j.tanggalBuku})</span>}
                  </td>
                  <td>
                    {j.aturan} · {j.keterangan}
                    <span className="keu-chip keadaan-belum">{LABEL_JENIS[j.jenis]}</span>
                    {j.status !== "aktif" && <span className="keu-pill">{LABEL_STATUS[j.status]}</span>}
                  </td>
                  <td>
                    <BarisJurnalTabel j={j} />
                  </td>
                  <td>{s ? <a href={s.href}>{s.label}</a> : <span className="t-tertiary">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TabelMemorial({
  code,
  daftar,
  wewenang,
  tanggalMemorial,
  judul,
}: {
  code: string;
  daftar: JurnalTampil[];
  wewenang: WewenangBukuBesar;
  tanggalMemorial: string;
  judul: string;
}) {
  return (
    <div className="tbl-scroll mt4">
      <table className="fs16" aria-label={judul}>
        <thead>
          <tr>
            <th className="left">Tanggal</th>
            <th className="left">Memorial</th>
            <th className="left">Baris</th>
            <th className="left">Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {daftar.length === 0 && (
            <tr>
              <td colSpan={5} className="t-tertiary">
                Tidak ada.
              </td>
            </tr>
          )}
          {daftar.map((j) => (
            <tr key={j.id}>
              <td className="num">{j.tanggalEfektif}</td>
              <td>
                {j.keterangan}
                <div className="fs15 t-tertiary">
                  diusulkan {j.diusulkanOleh ?? "—"}
                  {j.disetujuiOleh && ` · disetujui ${j.disetujuiOleh} ${j.disetujuiAt ?? ""}`}
                  {j.dibalikOleh && " · sudah dibalik"}
                </div>
              </td>
              <td>
                <BarisJurnalTabel j={j} />
              </td>
              <td>{LABEL_STATUS[j.status]}</td>
              <td>
                <MemorialTombol
                  code={code}
                  id={j.id}
                  status={j.status}
                  bolehSetujui={wewenang.bolehSetujui && j.diusulkanOlehId !== wewenang.userId}
                  bolehTarik={wewenang.bolehUsul && j.diusulkanOlehId === wewenang.userId}
                  bolehBalik={wewenang.bolehUsul && j.dibalikOleh === null && j.sumberTabel !== "jurnal"}
                  tanggalBalik={tanggalMemorial}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BukuBesarPanel(p: BukuBesarPanelProps) {
  const { code, bulan, tab, lap, keadaan, wewenang } = p;
  const menunggu = (p.memorial ?? []).filter((j) => j.status === "menunggu");
  const menungguUntukSaya = menunggu.filter((j) => j.diusulkanOlehId !== wewenang.userId);

  return (
    <>
      {lap.sementara.length > 0 && (
        <div className="banner warning keu-banner" role="status">
          <b>Laporan sementara</b>
          <ul className="keu-list">
            {lap.sementara.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {(keadaan.hariTanpaJurnal.length > 0 || keadaan.gagal.length > 0) && (
        <div className="banner danger keu-banner" role="alert">
          <b>Jurnal tertinggal</b>
          {keadaan.hariTanpaJurnal.length > 0 && (
            <p className="keu-p">Hari sudah tutup hari tetapi tanpa jurnal: {keadaan.hariTanpaJurnal.join(", ")}.</p>
          )}
          {keadaan.gagal.map((g) => (
            <p key={g.tanggal} className="keu-p">
              Pembentukan {g.tanggal} gagal: {g.galat}
            </p>
          ))}
          <p className="keu-p">Head of Finance memulihkannya dengan &quot;Bentuk ulang bulan ini&quot;.</p>
        </div>
      )}
      {wewenang.bolehSetujui && menungguUntukSaya.length > 0 && tab !== "memorial" && (
        <div className="banner info keu-banner" role="status">
          {menungguUntukSaya.length} jurnal memorial menunggu persetujuan Anda —{" "}
          <a href={href(code, bulan, { tab: "memorial" })}>buka Jurnal memorial</a>.
        </div>
      )}

      <p className="fs16 t-secondary mt4">
        Jurnal dibentuk s.d. <b>{keadaan.jurnalSampai ?? "belum pernah"}</b>
        {keadaan.ditutupBukuBesar ? " · bulan ini ditutup dengan buku besar (beku)" : keadaan.ditutup ? " · bulan ini ditutup tanpa buku besar" : ""}
      </p>
      {wewenang.bolehBentukUlang && p.rentangBentuk && !keadaan.ditutupBukuBesar && (
        <BentukUlangTombol code={code} dari={p.rentangBentuk.dari} sampai={p.rentangBentuk.sampai} />
      )}
      {wewenang.bolehBentukUlang && keadaan.ditutupBukuBesar && <KoreksiMajuTombol code={code} bulan={p.bulan} />}

      <nav className="keu-tabs" role="tablist" aria-label="Bagian buku besar">
        {TAB_BUKU_BESAR.map((t) => (
          <a key={t} role="tab" className="keu-tab" aria-selected={tab === t} href={href(code, bulan, { tab: t })}>
            {LABEL_TAB[t]}
            {t === "memorial" && menunggu.length > 0 && <span className="keu-pill">{menunggu.length}</span>}
          </a>
        ))}
      </nav>

      {tab === "neraca" && (
        <section aria-label="Neraca">
          {lap.neraca.kelompok.map((k) => (
            <TabelPos
              key={k.jenis}
              code={code}
              bulan={bulan}
              tab={tab}
              judul={k.judul}
              baris={k.baris}
              total={{ label: `Jumlah ${k.judul.toLowerCase()}`, nilaiSen: k.totalSen }}
              pilih={p.pos}
            />
          ))}
          <div className="tbl-scroll mt4">
            <table className="fs16">
              <tbody>
                <tr>
                  <td>3900 Laba tahun berjalan (dihitung dari kelas 4 dan 5)</td>
                  <td className="num">{rpSen(lap.neraca.labaBerjalanSen)}</td>
                </tr>
                <tr>
                  <td className="w600">Aset</td>
                  <td className="num w600">{rpSen(lap.neraca.totalAsetSen)}</td>
                </tr>
                <tr>
                  <td className="w600">Kewajiban + modal + laba berjalan</td>
                  <td className="num w600">{rpSen(lap.neraca.totalKewajibanModalSen)}</td>
                </tr>
                <tr>
                  <td className={lap.neraca.bedaSen === 0 ? "t-secondary" : "t-danger w600"}>Beda</td>
                  <td className={`num ${lap.neraca.bedaSen === 0 ? "t-secondary" : "t-danger w600"}`}>{rpSen(lap.neraca.bedaSen)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "laba-rugi" && (
        <section aria-label="Laba-rugi">
          <TabelPos code={code} bulan={bulan} tab={tab} judul="Pendapatan" baris={lap.labaRugi.pendapatan} total={{ label: "Jumlah pendapatan", nilaiSen: lap.labaRugi.totalPendapatanSen }} pilih={p.pos} />
          <TabelPos code={code} bulan={bulan} tab={tab} judul="Beban" baris={lap.labaRugi.beban} total={{ label: "Jumlah beban", nilaiSen: lap.labaRugi.totalBebanSen }} pilih={p.pos} />
          <p className="fs16 w600 mt4">Laba bersih bulan ini: {rpSen(lap.labaRugi.labaSen)}</p>
        </section>
      )}

      {(tab === "neraca" || tab === "laba-rugi") && p.pos && p.jurnalPos && <DaftarJurnalPos code={code} bulan={bulan} pos={p.pos} data={p.jurnalPos} />}

      {tab === "temuan-jurnal" && p.temuanJurnal && (
        <section aria-label="Temuan jurnal">
          <p className="fs16 t-tertiary mt4">
            Hal yang membuat jurnal tidak dibuat atau diparkir di pos kliring (1198/1103) — sama dengan jumlah temuan yang dilaporkan &quot;Bentuk
            ulang&quot;. Dibaca dari pembentukan terakhir setiap hari (Bentuk ulang, tutup hari, tutup bulan). Bukan selisih dengan laporan rumus — itu
            tab Temuan beda.
          </p>
          {p.temuanJurnal.total === 0 ? (
            <p className="fs16 mt4">Tidak ada temuan pada pembentukan terakhir bulan ini.</p>
          ) : (
            <>
              <ul className="fs16 mt4">
                {p.temuanJurnal.ringkas.map((r) => (
                  <li key={r.kode}>
                    {r.label}: <b>{r.n}</b>
                  </li>
                ))}
              </ul>
              {p.temuanJurnal.hariTanpaRincian.length > 0 && (
                <p className="fs16 t-tertiary mt2">
                  Pembentukan{" "}
                  {p.temuanJurnal.hariTanpaRincian.length > 3
                    ? `${p.temuanJurnal.hariTanpaRincian[0]} s.d. ${p.temuanJurnal.hariTanpaRincian.at(-1)} (${p.temuanJurnal.hariTanpaRincian.length} hari)`
                    : p.temuanJurnal.hariTanpaRincian.join(", ")}{" "}
                  terjadi sebelum rincian dicatat — jalankan &quot;Bentuk ulang bulan ini&quot; sekali untuk melihat baris mana yang dimaksud.
                </p>
              )}
              <div className="tbl-scroll mt4">
                <table className="fs16">
                  <thead>
                    <tr>
                      <th className="left">Tanggal</th>
                      <th className="left">Temuan</th>
                      <th className="left">Keterangan</th>
                      <th className="left">Perbaiki di</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.temuanJurnal.baris.map((t, i) => {
                      const ke = tautanTemuan(code, bulan, t.tanggal, t.kode);
                      return (
                        <tr key={`${t.tanggal}-${t.kode}-${t.sumberId ?? i}`}>
                          <td>{t.hari > 1 ? `${t.tanggal} s.d. ${t.sampai} (${t.hari} hari)` : t.tanggal}</td>
                          <td>{t.label}</td>
                          <td className="t-secondary">{t.pesan ?? "—"}</td>
                          <td>
                            <a href={ke.href}>{ke.label}</a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "temuan" && (
        <section aria-label="Temuan beda">
          {p.temuan === null ? (
            <p className="fs16 t-tertiary mt4">Belum ada hari di bulan ini untuk dibandingkan.</p>
          ) : (
            <>
              <p className="fs16 t-tertiary mt4">
                Buku besar dibandingkan dengan laporan rumus (Laporan Keuangan Harian) per {p.temuan.batas}. Laba rumus = jumlah net profit harian.
                Setiap beda perlu penjelasan; perbaikannya jurnal memorial beralasan.
              </p>
              <div className="tbl-scroll mt4">
                <table className="fs16">
                  <thead>
                    <tr>
                      <th className="left">Baris</th>
                      <th className="left">Pos</th>
                      <th>Buku besar</th>
                      <th>Laporan rumus</th>
                      <th>Beda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.temuan.baris.map((t) => (
                      <tr key={t.kunci}>
                        <td>
                          {t.label}
                          {t.temuan && <span className="keu-pill">temuan</span>}
                        </td>
                        <td className="t-secondary">{t.pos.join(", ")}</td>
                        <td className="num">{rpSen(t.bukuBesarSen)}</td>
                        <td className="num">{t.rumusSen === null ? <span className="t-tertiary">tak terhitung</span> : rpSen(t.rumusSen)}</td>
                        <td className={`num ${t.temuan ? "t-danger w600" : ""}`}>{t.bedaSen === null ? "—" : rpSen(t.bedaSen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {tab === "saldo-awal" && p.saldoAwal && (
        <section aria-label="Saldo awal">
          <p className="fs16 t-tertiary mt4">
            Saldo awal per 30 September 2026. Kas dan bank dibaca dari saldo pembuka rekening di Kelola akun kas; pos lain diisi Head of Finance dari
            data akuntan. Simpan ditolak bila aset ≠ kewajiban + modal — sistem tidak menambah angka penyeimbang.
          </p>
          <div className="tbl-scroll mt4">
            <table className="fs16" aria-label="Saldo pembuka rekening">
              <thead>
                <tr>
                  <th className="left">Rekening</th>
                  <th className="left">Pos</th>
                  <th>Saldo pembuka</th>
                </tr>
              </thead>
              <tbody>
                {p.saldoAwal.rekening.map((r) => (
                  <tr key={r.nama}>
                    <td>
                      {r.nama}
                      {r.sementara && <span className="keu-pill">sementara</span>}
                    </td>
                    <td className="t-secondary">{r.posKode ?? "tanpa sub-pos"}</td>
                    <td className="num">{r.saldoSen === null ? <span className="t-tertiary">belum ditetapkan</span> : rpSen(r.saldoSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tbl-scroll mt4">
            <table className="fs16" aria-label="Saldo awal pos tersimpan">
              <thead>
                <tr>
                  <th className="left">Pos tersimpan</th>
                  <th className="left">Sumber</th>
                  <th>Saldo (debet +)</th>
                </tr>
              </thead>
              <tbody>
                {p.saldoAwal.tersimpan.length === 0 && (
                  <tr>
                    <td colSpan={3} className="t-tertiary">
                      Belum diisi.
                    </td>
                  </tr>
                )}
                {p.saldoAwal.tersimpan.map((s) => (
                  <tr key={s.kode}>
                    <td>
                      {s.kode} {s.nama}
                    </td>
                    <td className="t-secondary">{s.sumber === "akun_kas" ? "rekening" : "akuntan"}</td>
                    <td className="num">{rpSen(s.saldoSen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {wewenang.bolehSaldoAwal && <SaldoAwalForm code={code} pos={p.saldoAwal.isian} kas={p.saldoAwal.kas} />}
        </section>
      )}

      {tab === "memorial" && (
        <section aria-label="Jurnal memorial">
          {menunggu.length > 0 && (
            <>
              <h2 className="text-h3 mt4">Menunggu persetujuan Direksi</h2>
              <TabelMemorial code={code} daftar={menunggu} wewenang={wewenang} tanggalMemorial={p.tanggalMemorial} judul="Memorial menunggu persetujuan" />
            </>
          )}
          <h2 className="text-h3 mt6">Memorial bulan ini</h2>
          <TabelMemorial
            code={code}
            daftar={(p.memorial ?? []).filter((j) => j.status !== "menunggu")}
            wewenang={wewenang}
            tanggalMemorial={p.tanggalMemorial}
            judul="Memorial bulan ini"
          />
          {wewenang.bolehUsul && !keadaan.ditutupBukuBesar && <MemorialForm code={code} tanggalAwal={p.tanggalMemorial} pilihanPos={p.pilihanPos} />}
          <p className="fs16 t-tertiary mt4">
            Pelanggan yang membayar ke rekening unit lain: di unit penerima debet 1199, kredit 2102; di unit pemilik piutang debet 1122, kredit 1121.
            Memorial yang menyentuh 1199 menunggu persetujuan Direksi.
          </p>
        </section>
      )}
    </>
  );
}
