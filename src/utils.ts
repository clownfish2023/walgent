/**
 * Common utility functions
 */

import { readFile } from "node:fs/promises";

/**
 * Read binary data from a file path.
 */
export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const buffer = await readFile(path);
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/**
 * Encode a string to UTF-8 bytes.
 */
export function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Decode bytes to a string.
 */
export function fromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Guess the MIME type based on the filename.
 */
export function guessContentType(filename: string): string | undefined {
  const ext = filename.toLowerCase().split(".").pop();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "pdf":
      return "application/pdf";
    case "json":
      return "application/json";
    case "txt":
    case "md":
      return "text/plain; charset=utf-8";
    case "html":
      return "text/html; charset=utf-8";
    default:
      return undefined;
  }
}

/**
 * Simple hex encoding.
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}