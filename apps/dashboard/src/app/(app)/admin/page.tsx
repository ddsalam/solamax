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

const GRID = "1.7fr 1fr 1.1fr 1.7fr 0.8fr 1.2fr";

/**
 * Kelola Akses — terbuka untuk super_admin (semua tenant) dan admin_perusahaan
 * (HANYA tenant-nya). Gerbangnya server-side di sini DAN di setiap aksi.
 *
 * ⚠️ Daftar pengguna (`app.users`) hanya dirender untuk super_admin. Tabel itu bukan
 *    tabel ber-unit, jadi RLS 0016 maupun unitVisible tidak menjaganya — merendernya
 *    untuk admin terdelegasi = membocorkan direktori pengguna PT lain.
 */
export default async function AdminPage() {
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
    q<MembershipRow>(
      `SELECT m.id, m.user_id, u.email, m.role, m.tenant_id, t.name AS tenant_name,
              m.status, m.all_units,
              COALESCE(array_agg(uu.unit_id) FILTER (WHERE uu.unit_id IS NOT NULL), '{}') AS unit_ids
         FROM app.membership m
         JOIN app.users u ON u.id = m.user_id
         LEFT JOIN app.tenant t ON t.id = m.tenant_id
         LEFT JOIN app.user_unit uu ON uu.membership_id = m.id
        WHERE $1::boolean OR m.tenant_id = ANY($2::uuid[])
        GROUP BY m.id, m.user_id, u.email, m.role, m.tenant_id, t.name, m.status, m.all_units
        ORDER BY u.email, m.role`,
      [isSuper, myTenants],
    ),
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

      {/* Penugasan terdaftar */}
      <div className="mt8">
        <div className="text-h6 t-brand">Penugasan terdaftar ({memberships.length})</div>
        <div className="card tbl-card mt4">
          <div className="grid-head" style={{ gridTemplateColumns: GRID }}>
            <span>Email</span>
            <span>Role</span>
            <span>Perusahaan</span>
            <span>Cakupan unit</span>
            <span>Status</span>
            <span />
          </div>
          {memberships.map((m) => {
            const tenantUnits = unitsOf(m.tenant_id);
            const isSuperRow = m.role === "super_admin";
            return (
              <div key={m.id} className="grid-row" style={{ gridTemplateColumns: GRID }}>
                <span className="fs16">{m.email}</span>
                <span className="fs16">
                  {isSuperRow ? (
                    ROLE_LABEL[m.role]
                  ) : (
                    <form action={setUserRole} style={{ display: "flex", gap: 4 }}>
                      <input type="hidden" name="membershipId" value={m.id} />
                      <select name="role" defaultValue={m.role} className="seg-btn fs15">
                        <option value="pengawas">Pengawas</option>
                        <option value="direksi">Direksi</option>
                        {isSuper && <option value="admin_perusahaan">Admin Perusahaan</option>}
                      </select>
                      <button type="submit" className="btn-outline sm">
                        Set
                      </button>
                    </form>
                  )}
                </span>
                <span className="fs16 t-secondary">{m.tenant_name ?? "— (lintas tenant)"}</span>
                <span className="fs16 t-secondary">
                  {isSuperRow ? (
                    "semua perusahaan"
                  ) : (
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
                      <button type="submit" className="btn-outline sm" style={{ justifySelf: "start" }}>
                        Simpan cakupan
                      </button>
                    </form>
                  )}
                </span>
                <span className="fs16 t-secondary">
                  {m.status === "active" ? "aktif" : m.status}
                </span>
                <span className="right" style={{ display: "grid", gap: 4 }}>
                  {!isSuperRow && (
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
                  )}
                  {isSuper && !isSuperRow && (
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
          {memberships.length === 0 && <div className="empty-inline">Belum ada penugasan.</div>}
        </div>
      </div>

      {/* Beri akses — super_admin saja */}
      {isSuper && (
        <div className="mt10">
          <div className="text-h6 t-brand">Beri / ubah akses</div>
          <AccessGrantForm users={users} tenants={tenants} units={units} action={grantAccess} />
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
