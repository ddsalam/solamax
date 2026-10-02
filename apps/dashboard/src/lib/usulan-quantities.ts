/** Usulan stores liters. null means not entered; a numeric zero is data. */
export function sumUsulanQuantities(values: readonly (number | null)[]): number | null {
  return values.reduce<number | null>(
    (total, value) => value === null ? total : (total ?? 0) + value,
    null,
  );
}

/** Editable KL uses the existing whole-liter / 3-decimal precision. */
export function parseUsulanKl(value: string): number | null {
  if (value.trim() === "") return null;
  const kl = Number(value.replace(",", "."));
  return Number.isFinite(kl) ? Math.round(kl * 1000) : Number.NaN;
}

/** Preserve explicit zero when opening an existing record or leaving a field. */
export function usulanLiterToKlInput(liters: number | null): string {
  return liters === null ? "" : (liters / 1000).toLocaleString("id-ID", {
    useGrouping: false, minimumFractionDigits: 0, maximumFractionDigits: 3,
  });
}

export interface UsulanInputValue {
  text: string;
  /** Keep original database precision until the user actually edits this cell. */
  liters: number | null;
}

export function usulanInputValue(liters: number | null): UsulanInputValue {
  return { text: usulanLiterToKlInput(liters), liters };
}

export function editUsulanInputValue(raw: string): UsulanInputValue {
  const text = sanitizeUsulanKl(raw);
  return { text, liters: parseUsulanKl(text) };
}

/** Digits, one decimal separator, at most three fractional digits, as before. */
export function sanitizeUsulanKl(raw: string): string {
  let value = raw.replace(/[^\d.,]/g, "").replace(/[.,]/g, ",");
  const separator = value.indexOf(",");
  if (separator !== -1) {
    value = value.slice(0, separator + 1) + value.slice(separator + 1).replace(/,/g, "").slice(0, 3);
  }
  return value;
}
