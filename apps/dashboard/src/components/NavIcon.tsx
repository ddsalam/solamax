/**
 * Ikon navigasi — inline SVG (tanpa dependensi icon-font). Satu ikon khas per
 * item menggantikan glyph huruf yang ambigu (K/R ganda). currentColor mengikuti
 * warna teks item; label penuh tetap diberikan lewat atribut `title` di Sidebar.
 */
export type IconName =
  | "home"
  | "droplet"
  | "clipboard"
  | "report"
  | "receipt"
  | "fuel"
  | "chart"
  | "users";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 9.5 10 3l7 6.5M5 8.5V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5" />,
  droplet: <path d="M10 3s5 5.2 5 8.5a5 5 0 0 1-10 0C5 8.2 10 3 10 3Z" />,
  clipboard: (
    <>
      <path d="M7.5 4H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-1.5" />
      <path d="M7.5 4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1h-5V4Z" />
      <path d="m7.5 11 1.7 1.7L13 9" />
    </>
  ),
  report: (
    <>
      <path d="M5 3h7l3 3v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M11.5 3v3H15M8 14v-3M10.5 14V9.5M13 14v-2" />
    </>
  ),
  receipt: (
    <>
      <path d="M5 3h10v14l-2-1.2L11 17l-2-1.2L7 17l-2-1.2V3Z" />
      <path d="M7.5 7h5M7.5 10h5" />
    </>
  ),
  fuel: (
    <>
      <path d="M5 17V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v12" />
      <path d="M4 17h9" />
      <path d="M7 8h3" />
      <path d="M12 8.5l2.2 2.2a1.5 1.5 0 0 0 1 .4h.3a1.2 1.2 0 0 1 1.2 1.2V14a1.3 1.3 0 0 0 2.6 0V9.2a1.5 1.5 0 0 0-.44-1.06L16 6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 16V8M8 16V4M12 16v-6M16 16V9" />
    </>
  ),
  users: (
    <>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M3 16c0-2.5 2-4 4.5-4S12 13.5 12 16" />
      <path d="M13 5.2a2.5 2.5 0 0 1 0 4.6M14 12.4c1.8.5 3 1.9 3 3.6" />
    </>
  ),
};

export function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="side-icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
