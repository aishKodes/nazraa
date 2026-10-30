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
  { code: "SA", name: "Saudi Arabia" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "NG", name: "Nigeria" },
  { code: "DZ", name: "Algeria" },
  { code: "MA", name: "Morocco" },
] as const;

/** Input aliases resolve to the same ISO key; never persist a display label. */
export function canonicalCountryCode(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    "SAUDI ARABIA": "SA", SAUDI: "SA", KSA: "SA",
    "UNITED ARAB EMIRATES": "AE", UAE: "AE", DUBAI: "AE", "UAE / DUBAI": "AE",
    NEPAL: "NP", NIGERIA: "NG", ALGERIA: "DZ", MOROCCO: "MA",
  };
  return aliases[normalized] ?? normalized;
}

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
