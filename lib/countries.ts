// Store ISO codes for API compatibility; show country names in the control panel.
export const panelCountries = [
  { code: "IN", name: "India" },
  { code: "NP", name: "Nepal" },
  { code: "BT", name: "Bhutan" },
  { code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },
  { code: "MV", name: "Maldives" },
  { code: "PK", name: "Pakistan" },
  { code: "AF", name: "Afghanistan" },
  { code: "MM", name: "Myanmar" },
  { code: "CN", name: "China" },
] as const;

export function isPanelCountry(code: string) {
  return panelCountries.some((country) => country.code === code);
}

export function countryName(code: string | null | undefined) {
  if (!code) return "—";
  const normalized = code.trim().toUpperCase();
  const country = panelCountries.find((item) => item.code === normalized);
  if (country) return country.name;
  // Preserve legacy countries when displaying existing records.
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(normalized) ?? normalized; }
  catch { return normalized; }
}
