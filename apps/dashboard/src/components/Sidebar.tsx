"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Laporan & Analisa", match: (p: string) => p === "/" || p.startsWith("/board") || p.startsWith("/unit") },
  { href: "/monitoring", label: "Monitoring Realtime", match: (p: string) => p.startsWith("/monitoring") && !p.startsWith("/monitoring/ketaatan"), badge: true },
  { href: "/monitoring/ketaatan", label: "Ketaatan Administrasi", match: (p: string) => p.startsWith("/monitoring/ketaatan") },
];

export function Sidebar({ alertCount }: { alertCount: number }) {
  const path = usePathname();
  return (
    <nav className="sidebar no-print">
      {ITEMS.map((it) => (
        <Link key={it.href} href={it.href} className={`side-item${it.match(path) ? " active" : ""}`}>
          <span>{it.label}</span>
          {it.badge && alertCount > 0 && <span className="side-badge">{alertCount}</span>}
        </Link>
      ))}
      <div className="side-foot">
        Menu mengikuti peran. Direksi melihat seluruh grup; pemilih unit bebas.
      </div>
    </nav>
  );
}
