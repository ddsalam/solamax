import Link from "next/link";
import { notFound } from "next/navigation";
import { getDataScope } from "@/lib/scope";
import { q } from "@/lib/db";
import {
  grantAccess,
  revokeAccess,
  setMembershipStatus,
  setUserRole,
  updateScope,
} from "@/lib/admin-actions";
import { AccessGrantForm } from "@/components/AccessGrantForm";
import { PESAN_HASIL, type KodeHasil } from "@/lib/admin-rules";
import { ADMIN_MEMBERSHIPS_SQL } from "@/lib/membership-query";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin_perusahaan: "Admin Perusahaan",
  direksi: "Direksi",
  pengawas: "Pengawas",
};

interface UserRow {
  id: number;
  email: string | null;
  name: string | null;
  role: string | null;
}
interface TenantRow {
  id: string;
  name: string;
}
interface UnitRow {
  unit_id: number;
  code: string;
  name: string;
  tenant_id: string | null;
}
interface MembershipRow {
  id: string;
  user_id: number;
  email: string | null;
  role: string;
  tenant_id: string | null;
  tenant_name: string | null;
  status: string;
  all_units: boolean;
  unit_ids: number[];
}
interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  tenant_name: string | null;
  created_at: string;
}
interface ConflictRow {
  email: string | null;
  roles: string;
}

const GRID = "1.2fr 1.8fr 0.7fr 1.1fr";

/**
 * Kelola Akses — terbuka untuk super_admin (semua tenant) dan admin_perusahaan
 * (HANYA tenant-nya). Gerbangnya server-side di sini DAN di setiap aksi.
 *
 * ⚠️ Daftar pengguna (`app.users`) hanya dirender untuk super_admin. Tabel itu bukan
 *    tabel ber-unit, jadi RLS 0016 maupun unitVisible tidak menjaganya — merendernya
 *    untuk admin terdelegasi = membocorkan direktori pengguna PT lain.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: { tambah?: string; h?: string };
}) {
  const scope = await getDataScope();
  if (!scope.canManageAccess) notFound(); // bukan sekadar sembunyikan menu
  const isSuper = scope.isSuperAdmin;
  const myTenants = scope.tenantIds;

  const [users, tenants, units, memberships, audits, conflicts] = await Promise.all([
    isSuper
      ? q<UserRow>(
          `SELECT u.id, u.email, u.name, r.role
             FROM app.users u LEFT JOIN app.user_role r ON r.user_id = u.id
            ORDER BY u.email`,
        )
      : Promise.resolve([] as UserRow[]),
    isSuper
      ? q<TenantRow>(`SELECT id, name FROM app.tenant WHERE status = 'active' ORDER BY name`)
      : q<TenantRow>(
          `SELECT id, name FROM app.tenant WHERE status = 'active' AND id = ANY($1::uuid[])
            ORDER BY name`,
          [myTenants],
        ),
    isSuper
      ? q<UnitRow>(
          `SELECT unit_id, code, name, tenant_id FROM public.unit WHERE active ORDER BY unit_id`,
        )
      : q<UnitRow>(
          `SELECT unit_id, code, name, tenant_id FROM public.unit
            WHERE active AND tenant_id = ANY($1::uuid[]) ORDER BY unit_id`,
          [myTenants],
        ),
    q<MembershipRow>(ADMIN_MEMBERSHIPS_SQL, [isSuper, myTenants]),
    q<AuditRow>(
      `SELECT a.id, a.actor_email, a.action, a.target, t.name AS tenant_name,
              to_char(a.created_at AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI') AS created_at
         FROM app.audit_log a LEFT JOIN app.tenant t ON t.id = a.tenant_id
        WHERE $1::boolean OR a.tenant_id = ANY($2::uuid[])
        ORDER BY a.created_at DESC LIMIT 50`,
      [isSuper, myTenants],
    ),
    q<ConflictRow>(
      `SELECT u.email, string_agg(DISTINCT m.role, ' / ' ORDER BY m.role) AS roles
         FROM app.membership m JOIN app.users u ON u.id = m.user_id
        WHERE $1::boolean OR m.tenant_id = ANY($2::uuid[])
        GROUP BY u.email HAVING count(DISTINCT m.role) > 1`,
      [isSuper, myTenants],
    ),
  ]);

  const unitsOf = (tenantId: string | null) => units.filter((u) => u.tenant_id === tenantId);

  const kode = searchParams.h;
  const hasil = kode && kode in PESAN_HASIL ? PESAN_HASIL[kode as KodeHasil] : null;

  /**
   * Kelompokkan penugasan PER ORANG. Pemetaan baris→membership TIDAK berubah: tiap
   * `m` tetap membawa `m.id` sendiri ke form "Simpan cakupan", dan `defaultChecked`
   * tetap dibaca dari `m.unit_ids`/`m.all_units` milik penugasan itu. Kalau
   * pengelompokan sampai menggeser pemetaan ini, admin yang menekan "Simpan cakupan"
   * akan menulis ulang akses orang lain — karena itu diverifikasi ulang dari DOM.
   */
  const perUser = [
    ...memberships
      .reduce((map, m) => {
        const g = map.get(m.user_id) ?? {
          user_id: m.user_id,
          email: m.email,
          role: m.role,
          items: [] as MembershipRow[],
        };
        g.items.push(m);
        map.set(m.user_id, g);
        return map;
      }, new Map<number, { user_id: number; email: string | null; role: string; items: MembershipRow[] }>())
      .values(),
  ].sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

  return (
    <div>
      <div className="text-eyebrow t-tertiary">Administrasi</div>
      <h1 className="text-h4 t-brand mt2">Kelola Akses Pengguna</h1>
      <p className="fs16 t-secondary mt2">
        Akses diberikan per-undangan. Satu pengguna boleh punya beberapa penugasan — di
        beberapa perusahaan sekaligus — dan hak efektifnya adalah <strong>gabungan</strong>{" "}
        semua penugasan aktif. Role bersifat <strong>tunggal per orang</strong>; yang melebar
        hanyalah cakupan perusahaan/unitnya.
      </p>
      {!isSuper && (
        <p className="fs15 t-tertiary mt2">
          Anda mengelola akses untuk perusahaan Anda sendiri. Menambah pengguna baru dan
          menghapus penugasan permanen adalah wewenang super admin; gunakan{" "}
          <strong>Nonaktifkan</strong> untuk mencabut akses sementara.
        </p>
      )}

      {/* Hasil aksi terakhir. Aksi server melempar, dan build produksi Next.js
          MENYEMBUNYIKAN pesannya — tanpa banner ini penolakan tak terlihat sama sekali,
          dan admin bisa mengira aksinya berhasil. Teksnya berasal dari KODE, bukan dari
          pesan galat: satu teks untuk SEMUA penolakan wewenang, apa pun sebabnya. */}
      {hasil && (
        <div
          className="card card-pad mt6"
          role="status"
          style={{
            borderStyle: "solid",
            borderWidth: 2,
            borderColor: hasil.nada === "ok" ? "var(--success)" : "var(--danger)",
          }}
        >
          <span className="fs16" style={{ color: hasil.nada === "ok" ? "var(--success)" : "var(--danger)" }}>
            {hasil.nada === "ok" ? "✓ " : "⚠️ "}
            {hasil.teks}
          </span>
        </div>
      )}

      {(scope.roleConflict || conflicts.length > 0) && (
        <div
          className="card card-pad mt6"
          style={{ borderColor: "var(--danger)", borderWidth: 2, borderStyle: "solid" }}
        >
          <div className="text-h6" style={{ color: "var(--danger)" }}>
            ⚠️ Invarian role dilanggar
          </div>
          <p className="fs15 t-secondary mt2">
            Role seharusnya tunggal per orang (ditegakkan constraint DB sejak migrasi 0019).
            Pengguna di bawah punya lebih dari satu role — sistem memakai yang{" "}
            <strong>paling restriktif</strong> sampai ini dibereskan.
          </p>
          <ul className="fs15 t-secondary mt2">
            {conflicts.map((c) => (
              <li key={c.email}>
                {c.email} — {c.roles}
              </li>
            ))}
            {conflicts.length === 0 && <li>akun Anda sendiri (lihat log server)</li>}
          </ul>
        </div>
      )}

      {/* Penugasan terdaftar — SATU BLOK PER ORANG.
          Sebelumnya satu baris per membership, sehingga kepemilikan lintas-PT tak
          pernah terlihat di layar dan kemampuannya tampak seperti tidak ada. */}
      <div className="mt8">
        <div className="text-h6 t-brand">
          Pengguna ({perUser.length}) · penugasan ({memberships.length})
        </div>
        {perUser.map((g) => {
          const isSuperUser = g.role === "super_admin";
          // Handle untuk aksi per-ORANG (role global): pakai penugasan pertama.
          const handle = g.items[0]!;
          return (
            <div key={g.user_id} className="card card-pad mt4">
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-3)",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span className="fs16 w600">{g.email}</span>
                {isSuperUser ? (
                  <span className="fs15 t-secondary">{ROLE_LABEL[g.role] ?? g.role}</span>
                ) : (
                  <form action={setUserRole} style={{ display: "flex", gap: 4 }}>
                    <input type="hidden" name="membershipId" value={handle.id} />
                    <select name="role" defaultValue={g.role} className="seg-btn fs15">
                      <option value="pengawas">Pengawas</option>
                      <option value="direksi">Direksi</option>
                      {isSuper && <option value="admin_perusahaan">Admin Perusahaan</option>}
                    </select>
                    <button type="submit" className="btn-outline sm">
                      Set
                    </button>
                  </form>
                )}
                <span className="fs15 t-tertiary">
                  {/* Bagi admin terdelegasi angka ini adalah yang TERLIHAT olehnya
                      (query di atas ter-filter tenant), bukan total milik orang itu.
                      Melabelinya "perusahaan" begitu saja akan menyiratkan total. */}
                  {g.items.length} {isSuper ? "perusahaan" : "penugasan di perusahaan Anda"}
                </span>
                {isSuper && !isSuperUser && (
                  <Link
                    href={`/admin?tambah=${g.user_id}#beri-akses`}
                    className="btn-outline sm"
                    style={{ marginLeft: "auto", textDecoration: "none" }}
                  >
                    + Tambah perusahaan
                  </Link>
                )}
              </div>

              {isSuperUser ? (
                <p className="fs15 t-tertiary mt3" style={{ marginBottom: 0 }}>
                  Lintas semua perusahaan. Tidak dikelola lewat layar ini.
                </p>
              ) : (
                <div className="tbl-card mt3">
                  <div className="grid-head" style={{ gridTemplateColumns: GRID }}>
                    <span>Perusahaan</span>
                    <span>Cakupan unit</span>
                    <span>Status</span>
                    <span />
                  </div>
                  {g.items.map((m) => {
                    const tenantUnits = unitsOf(m.tenant_id);
                    return (
                      <div key={m.id} className="grid-row" style={{ gridTemplateColumns: GRID }}>
                        <span className="fs16 t-secondary">{m.tenant_name ?? "—"}</span>
                        <span className="fs16 t-secondary">
                          <form action={updateScope} style={{ display: "grid", gap: 2 }}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="radio"
                                name="unitMode"
                                value="all"
                                defaultChecked={m.all_units}
                              />
                              <span className="fs15">semua unit PT</span>
                            </label>
                            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="radio"
                                name="unitMode"
                                value="list"
                                defaultChecked={!m.all_units}
                              />
                              <span className="fs15">unit tertentu:</span>
                            </label>
                            <span style={{ display: "grid", gap: 2, paddingLeft: 18 }}>
                              {tenantUnits.map((u) => (
                                <label
                                  key={u.unit_id}
                                  className="fs15"
                                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                                >
                                  <input
                                    type="checkbox"
                                    name="unitIds"
                                    value={u.unit_id}
                                    defaultChecked={m.unit_ids.includes(u.unit_id)}
                                  />
                                  {u.code}
                                </label>
                              ))}
                            </span>
                            <button
                              type="submit"
                              className="btn-outline sm"
                              style={{ justifySelf: "start" }}
                            >
                              Simpan cakupan
                            </button>
                          </form>
                        </span>
                        <span className="fs16 t-secondary">
                          {m.status === "active" ? "aktif" : m.status}
                        </span>
                        <span className="right" style={{ display: "grid", gap: 4 }}>
                          <form action={setMembershipStatus}>
                            <input type="hidden" name="membershipId" value={m.id} />
                            <input
                              type="hidden"
                              name="status"
                              value={m.status === "active" ? "disabled" : "active"}
                            />
                            <button type="submit" className="btn-outline sm">
                              {m.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                            </button>
                          </form>
                          {isSuper && (
                            <form action={revokeAccess}>
                              <input type="hidden" name="membershipId" value={m.id} />
                              <button type="submit" className="btn-outline sm">
                                Hapus
                              </button>
                            </form>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {memberships.length === 0 && <div className="empty-inline mt4">Belum ada penugasan.</div>}
      </div>

      {/* Beri akses — super_admin saja */}
      {isSuper && (
        <div className="mt10" id="beri-akses">
          <div className="text-h6 t-brand">Beri akses / tambah perusahaan</div>
          <AccessGrantForm
            users={users}
            tenants={tenants}
            units={units}
            action={grantAccess}
            preselectUserId={searchParams.tambah}
          />
          <p className="fs15 t-tertiary mt3">
            super_admin tidak diberikan di sini (hanya lewat SUPERADMIN_EMAILS). Cakupan
            &quot;unit tertentu&quot; tanpa satu pun unit dicentang = tidak melihat data apa pun
            (default-deny).
          </p>
        </div>
      )}

      {/* Jejak audit */}
      <div className="mt10">
        <div className="text-h6 t-brand">Jejak audit ({audits.length} terakhir)</div>
        <div className="card tbl-card mt4">
          <div className="grid-head" style={{ gridTemplateColumns: "1.2fr 1.2fr 1.6fr 1.4fr" }}>
            <span>Waktu (WIB)</span>
            <span>Aksi</span>
            <span>Oleh</span>
            <span>Perusahaan</span>
          </div>
          {audits.map((a) => (
            <div
              key={a.id}
              className="grid-row"
              style={{ gridTemplateColumns: "1.2fr 1.2fr 1.6fr 1.4fr" }}
            >
              <span className="fs15 t-secondary">{a.created_at}</span>
              <span className="fs15">{a.action}</span>
              <span className="fs15 t-secondary">{a.actor_email}</span>
              <span className="fs15 t-secondary">{a.tenant_name ?? "—"}</span>
            </div>
          ))}
          {audits.length === 0 && <div className="empty-inline">Belum ada jejak audit.</div>}
        </div>
      </div>
    </div>
  );
}
