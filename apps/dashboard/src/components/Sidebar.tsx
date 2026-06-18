"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navigasi tunggal: rail kiri ber-grup yang bisa diringkas. Menggantikan empat
 * permukaan nav lama (Sidebar lama + TopbarNav + MonTabs + hub 4-langkah).
 *
 * Menu IDENTIK untuk semua peran — tak ada penyaringan berbasis role. Akses
 * ditegakkan di SERVER (admin → notFound utk non-super; halaman per-unit lewat
 * scope.requireUnit/ScopedUnitId). State ringkas/buka-tutup dipegang AppShell.
 */

export type GroupId = "monitoring" | "laporan" | "direksi";
export const GROUP_IDS: GroupId[] = ["monitoring", "laporan", "direksi"];

interface NavItem {
  /** null = nonaktif (mis. butuh unit tetapi tak ada unit dalam scope). */
  href: string | null;
  label: string;
  match: (p: string) => boolean;
  badge?: boolean;
}
interface NavGroup {
  id: GroupId;
  title: string;
  items: NavItem[];
}

/** Hrefs per-unit memakai unit default (Fase 2: scope.units[0] + hari ini);
 *  Fase 3 menggantinya dengan pilihan terbawa dari topbar. */
function buildGroups(unitCode: string | undefined, date: string): NavGroup[] {
  return [
    {
      id: "monitoring",
      title: "Monitoring realtime",
      items: [
        {
          href: unitCode ? `/monitoring/denah/${unitCode}` : null,
          label: "Denah tangki & nozzle",
          match: (p) => p.startsWith("/monitoring/denah") || p === "/monitoring",
        },
        {
          href: "/monitoring/ketaatan",
          label: "Ketaatan administrasi",
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
          match: (p) => /^\/unit\/[^/]+\/laporan/.test(p),
        },
        {
          href: unitCode ? `/unit/${unitCode}/rincian/${date}` : null,
          label: "Rincian penjualan",
          match: (p) => /^\/unit\/[^/]+\/rincian/.test(p),
        },
      ],
    },
    {
      id: "direksi",
      title: "Direksi & admin",
      items: [
        { href: "/board", label: "Ringkasan direksi", match: (p) => p.startsWith("/board") },
        { href: "/admin", label: "Kelola akses", match: (p) => p.startsWith("/admin") },
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
  onToggleCollapse,
  onToggleGroup,
}: {
  unitCode?: string;
  date: string;
  alertCount: number;
  collapsed: boolean;
  openGroups: Record<GroupId, boolean>;
  onToggleCollapse: () => void;
  onToggleGroup: (id: GroupId) => void;
}) {
  const path = usePathname();
  const groups = buildGroups(unitCode, date);

  const renderItem = (it: NavItem) => {
    const glyph = it.label.charAt(0);
    if (it.href === null) {
      return (
        <span key={it.label} className="side-item disabled" aria-disabled="true" title={it.label}>
          <span className="side-glyph">{glyph}</span>
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
        <span className="side-glyph">{glyph}</span>
        <span className="side-label">{it.label}</span>
        {it.badge && alertCount > 0 && <span className="side-badge">{alertCount}</span>}
      </Link>
    );
  };

  return (
    <nav className="sidebar no-print">
      <button
        type="button"
        className="side-toggle"
        onClick={onToggleCollapse}
        aria-label={collapsed ? "Lebarkan menu" : "Ringkas menu"}
      >
        {collapsed ? "»" : "«"}
      </button>

      <Link href="/" className={`side-item${path === "/" ? " active" : ""}`} title="Beranda">
        <span className="side-glyph">B</span>
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
    </nav>
  );
}
