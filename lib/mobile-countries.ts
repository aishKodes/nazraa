import { z } from "zod";

export const mobileCountryCodes = [
  "AF", "AL", "AD", "AQ", "AZ", "BD", "CF", "CN", "CI", "GL", "HU",
  "IN", "IQ", "IT", "NE", "OM", "PK", "RS", "ES", "LK", "AE",
] as const;

export const mobileCountryCodeSchema = z.enum(mobileCountryCodes);
