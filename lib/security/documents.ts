import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export type PreparedDocument = {
  id: string;
  documentType: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  encryptedData: Buffer;
  iv: Buffer;
  tag: Buffer;
};

const allowedTypes = new Set(["image/jpeg", "image/png", "application/pdf"]);

function encryptionKey() {
  const encoded = process.env.DOCUMENT_ENCRYPTION_KEY;
  if (!encoded) throw new Error("DOCUMENT_ENCRYPTION_KEY is missing in Vercel.");
  const key = Buffer.from(encoded, "base64");
  if (key.length === 32) return key;
  if (encoded.length >= 32) return createHash("sha256").update(encoded).digest();
  throw new Error("DOCUMENT_ENCRYPTION_KEY must contain at least 32 characters.");
}

export async function preparePrivateDocument(file: File, id: string, documentType: string, maxBytes = 2 * 1024 * 1024): Promise<PreparedDocument | null> {
  if (!file.size) return null;
  if (file.size > maxBytes) throw new Error(`${documentType} must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`);
  if (!allowedTypes.has(file.type)) throw new Error(`${documentType} must be a JPG, PNG, or PDF.`);
  const plain = Buffer.from(await file.arrayBuffer());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encryptedData = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    id,
    documentType,
    originalName: file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255),
    mimeType: file.type,
    byteSize: file.size,
    encryptedData,
    iv,
    tag: cipher.getAuthTag(),
  };
}

export function preparePrivateDocumentDataUrl(input: { dataUrl: string; id: string; documentType: string; originalName: string }): PreparedDocument {
  const match = /^data:(image\/(?:jpeg|png)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl);
  if (!match) throw new Error(`${input.documentType} must be a JPG, PNG, or PDF.`);
  const plain = Buffer.from(match[2], "base64");
  if (!plain.length || plain.length > 2 * 1024 * 1024) throw new Error(`${input.documentType} must be 2 MB or smaller.`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encryptedData = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    id: input.id,
    documentType: input.documentType,
    originalName: input.originalName.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 255) || "agency-proof",
    mimeType: match[1],
    byteSize: plain.length,
    encryptedData,
    iv,
    tag: cipher.getAuthTag(),
  };
}

export function decryptPrivateDocument(input: { encryptedData: Buffer; iv: Buffer; tag: Buffer }) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), input.iv);
  decipher.setAuthTag(input.tag);
  return Buffer.concat([decipher.update(input.encryptedData), decipher.final()]);
}

export function encryptPrivateText(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encryptedData = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { encryptedData, iv, tag: cipher.getAuthTag() };
}

export function decryptPrivateText(input: { encryptedData: Buffer; iv: Buffer; tag: Buffer }) {
  return decryptPrivateDocument(input).toString("utf8");
}
