import assert from "node:assert/strict";
import { currentPublicAssetUrl, publicApiOrigin } from "../lib/config/public-api-origin";

const old = process.env.NAZRAA_PUBLIC_API_ORIGIN;
try {
  delete process.env.NAZRAA_PUBLIC_API_ORIGIN;
  assert.equal(publicApiOrigin(), "https://nazraa.vercel.app");
  process.env.NAZRAA_PUBLIC_API_ORIGIN = "https://api.nazraa.pixtra.site";
  assert.equal(publicApiOrigin(), "https://api.nazraa.pixtra.site");
  assert.equal(
    currentPublicAssetUrl("https://nazraa.vercel.app/api/v1/assets/banners/asset-id"),
    "https://api.nazraa.pixtra.site/api/v1/assets/banners/asset-id",
  );
  assert.equal(
    currentPublicAssetUrl("https://nazraa.vercel.app/privacy"),
    "https://nazraa.vercel.app/privacy",
  );
  assert.equal(
    currentPublicAssetUrl("https://other.example/api/v1/assets/banners/id"),
    "https://other.example/api/v1/assets/banners/id",
  );
  for (const invalid of [
    "http://api.nazraa.pixtra.site",
    "https://api.nazraa.pixtra.site/path",
    "https://api.nazraa.pixtra.site/?token=secret",
    "https://user:pass@api.nazraa.pixtra.site",
  ]) {
    process.env.NAZRAA_PUBLIC_API_ORIGIN = invalid;
    assert.throws(publicApiOrigin);
  }
  console.log("PASS: configured public API origin preserves old release default and rejects unsafe values");
} finally {
  if (old === undefined) delete process.env.NAZRAA_PUBLIC_API_ORIGIN;
  else process.env.NAZRAA_PUBLIC_API_ORIGIN = old;
}
