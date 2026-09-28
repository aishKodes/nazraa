#!/usr/bin/env node
// Decrypt the one-time Vercel handoff on the VPS only. No secret is logged.
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from "node:crypto";
import { open, readFile, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const appNames = [
  "DOCUMENT_ENCRYPTION_KEY",
  "SESSION_SECRET",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "GOOGLE_OAUTH_CLIENT_IDS",
  "CRON_SECRET",
];
const sourceNames = [
  "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_SSL",
];
const requiredNames = [...appNames, ...sourceNames];

async function main() {
  const [, , privateKeyPath, envelopePath, envPath, sourceEnvPath] = process.argv;
  if (!privateKeyPath || !envelopePath || !envPath || !sourceEnvPath || process.getuid?.() !== 0) {
    throw new Error("Run as root with private-key, envelope, app.env, and source-db.env paths.");
  }
  if (dirname(sourceEnvPath) !== dirname(envPath) || basename(sourceEnvPath) !== "source-db.env") {
    throw new Error("The source credentials must use the separate source-db.env file.");
  }
  const [keyStat, envelopeStat, envStat] = await Promise.all([
    stat(privateKeyPath), stat(envelopePath), stat(envPath),
  ]);
  for (const entry of [keyStat, envelopeStat, envStat]) {
    if (entry.uid !== 0 || (entry.mode & 0o077) !== 0) {
      throw new Error("All handoff files must be root-owned and private.");
    }
  }

  const envelope = JSON.parse(await readFile(envelopePath, "utf8"));
  if (envelope.version !== 1) throw new Error("Unsupported handoff envelope.");
  for (const key of ["ephemeralPublicKey", "salt", "iv", "tag", "ciphertext"]) {
    if (typeof envelope[key] !== "string" || envelope[key].length > 16_384) {
      throw new Error("Invalid handoff envelope.");
    }
  }
  const privateKey = createPrivateKey(await readFile(privateKeyPath));
  const ephemeral = createPublicKey({
    key: Buffer.from(envelope.ephemeralPublicKey, "base64"), format: "der", type: "spki",
  });
  if (privateKey.asymmetricKeyType !== "x25519" || ephemeral.asymmetricKeyType !== "x25519") {
    throw new Error("Invalid handoff key type.");
  }
  const shared = diffieHellman({ privateKey, publicKey: ephemeral });
  const key = Buffer.from(hkdfSync(
    "sha256", shared, Buffer.from(envelope.salt, "base64"), "nazraa-vps-secret-handoff-v1", 32,
  ));
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final(),
  ]);
  key.fill(0);
  shared.fill(0);
  const values = JSON.parse(plain.toString("utf8"));
  plain.fill(0);
  if (!values || typeof values !== "object" || Object.keys(values).length !== requiredNames.length) {
    throw new Error("Unexpected handoff contents.");
  }
  for (const name of requiredNames) {
    const value = values[name];
    if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) {
      throw new Error("Invalid handoff value.");
    }
  }
  if (!/^wss:\/\//i.test(values.LIVEKIT_URL) || values.SESSION_SECRET.length < 32) {
    throw new Error("Required server configuration is incomplete.");
  }
  if (!/^\d{1,5}$/.test(values.DB_PORT) || !/^(true|false)$/i.test(values.DB_SSL)) {
    throw new Error("Invalid source database configuration.");
  }

  const existing = await readFile(envPath, "utf8");
  for (const name of appNames) {
    if (new RegExp(`^${name}=`, "m").test(existing)) {
      throw new Error("An imported setting already exists; refusing to overwrite it.");
    }
  }
  const payload = `${existing.trimEnd()}\n${appNames.map((name) => `${name}=${values[name]}`).join("\n")}\n`;
  const tempPath = join(dirname(envPath), `.app-env-handoff-${process.pid}`);
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  // Source database credentials must never enter app.env; otherwise a future
  // Compose restart could accidentally reconnect Nazraa to the old writer.
  const sourceHandle = await open(sourceEnvPath, "wx", 0o600);
  try {
    await sourceHandle.writeFile(`${sourceNames.map((name) => `${name}=${values[name]}`).join("\n")}\n`);
    await sourceHandle.sync();
  } finally {
    await sourceHandle.close();
  }
  await rename(tempPath, envPath);
  console.log(`Imported ${appNames.length} runtime and ${sourceNames.length} source-only settings without printing values.`);
}

main().catch(() => {
  console.error("Secure handoff import failed; existing app.env was not intentionally modified.");
  process.exitCode = 1;
});
