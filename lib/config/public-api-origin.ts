/** Public asset/API origin for links returned to Nazraa clients. */
export function publicApiOrigin(): string {
  const raw = process.env.NAZRAA_PUBLIC_API_ORIGIN?.trim() || "https://nazraa.vercel.app";
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9.-]+$/i.test(url.hostname) ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("NAZRAA_PUBLIC_API_ORIGIN must be an HTTPS origin.");
  }
  return url.origin;
}
