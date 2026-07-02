/**
 * Sanitasi teks KHUSUS jalur PDF (dipakai SEMUA laporan). Font Roboto tertanam
 * pdfmake tak punya sebagian glyph dekoratif/simbol → tampil sbg kotak kosong.
 * Ganti HANYA glyph yang terbukti hilang (cek cmap Roboto via fontkit) dengan
 * padanan ASCII yang setia maknanya. Teks LAYAR tak tersentuh.
 *
 * Terbukti ADA di Roboto → SENGAJA TIDAK dipetakan (setia ke layar):
 *   · (U+00B7)  − (U+2212)  — (U+2014)  – (U+2013)  Σ ±  ≥ ≤ ≠  … × № › δ ÷ • °
 */
export const GLYPH_MAP: Record<string, string> = {
  "⊎": "+", // multiset-union
  "⚠": "!", // warning
  "✓": "OK",
  "✔": "OK",
  "✗": "x",
  "✘": "x",
  "→": "->",
  "←": "<-",
  "↑": "^",
  "↓": "v",
  "▲": "^", // trend up
  "▼": "v", // trend down
  "▾": "v", // expand chevron
  "⟳": "*", // "angka pernah dikoreksi" marker
  "⇒": "=>",
  "≡": "=",
  "↔": "<->",
};

const GLYPH_RE = /[⊎⚠✓✔✗✘→←↑↓▲▼▾⟳⇒≡↔]/g;

/** Ganti glyph yang tak didukung Roboto dengan padanan ASCII. Idempoten. */
export function pdfText(s: string): string {
  return s.replace(GLYPH_RE, (c) => GLYPH_MAP[c] ?? c);
}
