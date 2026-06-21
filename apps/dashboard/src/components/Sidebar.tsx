"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon, type IconName } from "@/components/NavIcon";
import { ago } from "@/lib/format";
import { deriveTopbarSelection } from "@/lib/selection-keys";

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
          href: unitCode ? `/unit/${unitCode}/laporan/${date}` : null,
          label: "Operasional harian",
          icon: "report",
          match: (p) => /^\/unit\/[^/]+\/laporan/.test(p),
        },
        {
          href: unitCode ? `/unit/${unitCode}/rincian/${date}` : null,
          label: "Rincian penjualan",
          icon: "receipt",
          match: (p) => /^\/unit\/[^/]+\/rincian/.test(p),
        },
      ],
    },
    {
      id: "direksi",
      title: "Direksi & admin",
      items: [
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
}) {
  const path = usePathname();
  // Di rute laporan, link laporan/rincian ikut unit+tanggal URL (otoritatif) →
  // pindah Laporan↔Rincian pertahankan tanggal kini, bukan cookie basi.
  const { unit: navUnit, date: navDate } = deriveTopbarSelection(path, unitCode, date);
  const groups = buildGroups(navUnit, navDate);

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

      {/* Identitas (mobile) — dipindah dari topbar yang diringkas */}
      <div className="drawer-foot mobile-only">
        <span className="fs15 w600 t-secondary">{roleLabel}</span>
        {email && <span className="fs15 t-tertiary auth-email">{email}</span>}
        <span className="fs15 t-tertiary">
          {lastSync ? `data terakhir masuk ${ago(lastSync)}` : "menunggu koneksi data"}
        </span>
      </div>
    </nav>
  );
}
