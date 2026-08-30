import type { SelectHTMLAttributes } from "react";
import { countryName, isPanelCountry, panelCountries } from "@/lib/countries";

export function CountrySelect({ defaultValue = "IN", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const current = String(props.value ?? defaultValue);
  return <select name="countryCode" required defaultValue={props.value === undefined ? defaultValue : undefined} {...props}>
    {panelCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
    {!isPanelCountry(current) ? <option value={current}>{countryName(current)}</option> : null}
  </select>;
}
