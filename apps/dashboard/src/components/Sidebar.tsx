"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type IconName } from "@/components/NavIcon";
import { ago } from "@/lib/format";

/**
 * Navigasi tunggal: rail kiri ber-grup yang bisa diringkas (desktop) dan
 * berubah jadi drawer off-canvas di mobile (≤768px). Menggantikan empat
 * permukaan nav lama. Menu IDENTIK untuk semua peran — akses ditegakkan di
 * SERVER (admin → notFound non-super; per-unit lewat requireUnit/ScopedUnitId).
 */

export type GroupId = "monitoring" | "laporan" | "direksi";
export const GROUP_IDS: GroupId[] = ["monitoring", "laporan", "direksi"];

interface NavItem {
  href: string | null; // null = nonaktif (butuh unit tetapi tak ada unit scope)
  label: string;
  icon: IconName;
  match: (p: string) => boolean;
  badge?: boolean;
}
interface NavGroup {
  id: GroupId;
  title: string;
  items: NavItem[];
}

function buildGroups(unitCode: string | undefined, date: string): NavGroup[] {
  return [
    {
      id: "monitoring",
      title: "Monitoring realtime",
      items: [
        {
          href: unitCode ? `/monitoring/denah/${unitCode}` : null,
          label: "Denah tangki & nozzle",
          icon: "droplet",
          match: (p) => p.startsWith("/monitoring/denah") || p === "/monitoring",
        },
        {
          href: "/monitoring/ketaatan",
          label: "Ketaatan administrasi",
          icon: "clipboard",
          match: (p) => p.startsWith("/monitoring/ketaatan"),
          badge: true,
        },
      ],
    },
    {
      id: "laporan",
      title: "Laporan",
      items: [
        {
          href: unitCode ? `/unit/${unitCode}/rincian/${date}` : null,
          label: "Rincian penjualan",
          icon: "receipt",
          match: (p) => /^\/unit\/[^/]+\/rincian/.test(p),
        },
        {
          href: unitCode ? `/unit/${unitCode}/laporan/${date}` : null,
          label: "Operasional harian",
          icon: "report",
          match: (p) => /^\/unit\/[^/]+\/laporan/.test(p),
        },
        {
          href: unitCode ? `/unit/${unitCode}/usulan/${date}` : null,
          label: "Usulan Penebusan SO",
          icon: "fuel",
          match: (p) => /^\/unit\/[^/]+\/usulan/.test(p),
        },
      ],
    },
    {
      id: "direksi",
      title: "Direksi & admin",
      items: [
        {
          href: "/laporan-harian",
          label: "Laporan Harian",
          icon: "report",
          match: (p) => p.startsWith("/laporan-harian"),
        },
        { href: "/board", label: "Ringkasan direksi", icon: "chart", match: (p) => p.startsWith("/board") },
        { href: "/admin", label: "Kelola akses", icon: "users", match: (p) => p.startsWith("/admin") },
      ],
    },
  ];
}

export function Sidebar({
  unitCode,
  date,
  alertCount,
  collapsed,
  openGroups,
  mobileOpen,
  onToggleCollapse,
  onToggleGroup,
  onCloseMobile,
  email,
  roleLabel,
  lastSync,
  lastSyncUnit,
  signOutSlot,
}: {
  unitCode?: string;
  date: string;
  alertCount: number;
  collapsed: boolean;
  openGroups: Record<GroupId, boolean>;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onToggleGroup: (id: GroupId) => void;
  onCloseMobile: () => void;
  email: string | null;
  roleLabel: string;
  lastSync: string | null;
  /** Unit dengan sinkron TERLAMA — disebut namanya, lihat komentar di bawah. */
  lastSyncUnit: string | null;
  /** Tombol Keluar (server action). Hanya tampil ≥769px — di mobile ia tetap
   *  di topbar, sehingga perilaku ≤768px tak berubah sama sekali. */
  signOutSlot: React.ReactNode;
}) {
  const path = usePathname();
  // unitCode/date sudah diresolusi AppShell via useSelection (URL kanonik) →
  // link sidebar selalu mengikuti unit+tanggal yang tampil di picker.
  const groups = buildGroups(unitCode, date);

  const renderItem = (it: NavItem) => {
    if (it.href === null) {
      return (
        <span key={it.label} className="side-item disabled" aria-disabled="true" title={it.label}>
          <NavIcon name={it.icon} />
          <span className="side-label">{it.label}</span>
        </span>
      );
    }
    const active = it.match(path);
    return (
      <Link
        key={it.label}
        href={it.href}
        className={`side-item${active ? " active" : ""}`}
        title={it.label}
      >
        <NavIcon name={it.icon} />
        <span className="side-label">{it.label}</span>
        {it.badge && alertCount > 0 && (
          <span className="side-badge">{alertCount > 9 ? "9+" : alertCount}</span>
        )}
      </Link>
    );
  };

  return (
    <nav
      className={`sidebar no-print${mobileOpen ? " mobile-open" : ""}`}
      role="dialog"
      aria-modal={mobileOpen}
      aria-label="Menu navigasi"
    >
      {/* Logo TIDAK lagi di sini. Ia dulu dirender dua kali (topbar + sini);
          instance tunggalnya kini hidup di `.topbar` — satu-satunya wadah yang
          terlihat saat drawer mobile tertutup — dan ditempatkan sebagai baris
          merek kolom kiri di ≥769px lewat grid-area "brand". Lihat AppShell. */}
      <div className="side-top">
        <button
          type="button"
          className="side-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Lebarkan menu" : "Ringkas menu"}
        >
          {collapsed ? "»" : "«"}
        </button>
        <button
          type="button"
          className="drawer-close mobile-only"
          onClick={onCloseMobile}
          aria-label="Tutup menu"
        >
          ✕
        </button>
      </div>

      <Link href="/" className={`side-item${path === "/" ? " active" : ""}`} title="Beranda">
        <NavIcon name="home" />
        <span className="side-label">Beranda</span>
      </Link>

      {groups.map((g) => (
        <div key={g.id} className={`side-group${openGroups[g.id] ? "" : " closed"}`}>
          <button
            type="button"
            className="side-group-head"
            onClick={() => onToggleGroup(g.id)}
            aria-expanded={openGroups[g.id]}
          >
            <span className="side-group-title side-label">{g.title}</span>
            <span className="side-chevron">{openGroups[g.id] ? "▾" : "▸"}</span>
          </button>
          <div className="side-group-items">{g.items.map(renderItem)}</div>
        </div>
      ))}

      {/* Identitas — kini di SEMUA ukuran layar (dulu `mobile-only`). Di ≥769px
          topbar disembunyikan, jadi inilah satu-satunya tempat peran, email,
          kesegaran, dan Keluar. `.side-label` dipakai agar rail ringkas (64px)
          menyembunyikannya lewat aturan collapsed yang sudah ada. */}
      <div className="drawer-foot">
        <span className="fs15 w600 t-secondary side-label">{roleLabel}</span>
        {email && <span className="fs15 t-tertiary auth-email side-label">{email}</span>}
        {/* Nilai lastSync = MIN lintas scope (unit TERBURUK). Menyebut angka
            tanpa unit berbunyi seperti pernyataan tentang satu unit — cacat yang
            tercatat sejak insiden Bakau. Bunyinya disamakan dengan Laporan
            Harian: sebut unitnya. */}
        <span className="fs15 t-tertiary side-label">
          {lastSync
            ? `Sinkron terlama: ${lastSyncUnit ?? "—"}, ${ago(lastSync)}`
            : "Ada unit yang belum pernah tersinkron"}
        </span>
        <div className="foot-actions">{signOutSlot}</div>
      </div>
    </nav>
  );
}
