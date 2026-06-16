#!/usr/bin/env node
/**
 * Walgent Demo Script
 *
 * Demonstrates the real Agent -> Skill -> Walrus flow.
 *
 * When ZHIPU_API_KEY is set, this script calls the real GLM / CogView-3
 * image generation API to produce an actual AI image, uploads it to Walrus,
 * and opens the preview in the default browser.
 *
 * Without ZHIPU_API_KEY it falls back to the SVG placeholder provider so the
 * demo still runs offline.
 *
 * Usage:
 *   node scripts/demo.mjs "a cat on blockchain"
 *   node scripts/demo.mjs
 *
 * Env vars:
 *   ZHIPU_API_KEY   (optional) enables real GLM / CogView-3 image generation
 *   OPENAI_API_KEY  (optional) enables DALL-E 3 instead
 */

// Auto-load .env file if it exists (zero-dependency dotenv replacement)
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env into process.env (doesn't override existing env vars)
(function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, "..", ".env"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // Don't override existing env vars
      if (!process.env[key]) process.env[key] = val;
    }
    break;
  }
})();

const DEFAULT_PROMPT = "a cute robot painting a sunset, digital art, vibrant colors";
const WALRUS_PUBLISHER =
  "https://publisher.walrus-testnet.walrus.space/v1/blobs?epochs=1";
const WALRUS_AGGREGATOR_BASE =
  "https://aggregator.walrus-testnet.walrus.space/v1/blobs";
const OUTPUT_DIR = "demo-output";

// ─────────────────────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────────────────────

/**
 * Call Zhipu GLM CogView-3 to generate a real image.
 * Returns: { data: Buffer, contentType: string, ext: string }
 */
async function generateWithGlm(prompt) {
  const apiKey = process.env.ZHIPU_API_KEY || process.env.GLM_API_KEY || process.env.ZHIPUAI_API_KEY;
  if (!apiKey) throw new Error("ZHIPU_API_KEY not set");

  console.log("  [debug] Using API key: " + apiKey.slice(0, 8) + "..." + apiKey.slice(-4));

  const res = await fetch(
    "https://open.bigmodel.cn/api/paas/v4/images/generations",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: "glm-image",
        prompt: prompt.slice(0, 4000),
        size: "1280x1280",
        quality: "standard",
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("GLM API error " + res.status + ": " + text);
  }

  const json = await res.json();
  const item = json.data?.[0];
  if (!item) throw new Error("GLM response missing data[0]");

  // glm-image returns a URL; download the image bytes
  if (item.url) {
    console.log("  [debug] Downloading image from: " + item.url.slice(0, 80) + "...");
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error("Failed to download GLM image: " + imgRes.status);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get("content-type") || "image/png";
    const ext = ct.includes("png") ? "png" : ct.includes("jpeg") ? "jpg" : "png";
    return { data: buf, contentType: ct, ext };
  }

  if (item.b64_json) {
    return {
      data: Buffer.from(item.b64_json, "base64"),
      contentType: "image/png",
      ext: "png",
    };
  }

  throw new Error("GLM response missing url and b64_json");
}

/**
 * Call OpenAI DALL-E 3 to generate a real image.
 */
async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: prompt.slice(0, 4000),
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("OpenAI API error " + res.status + ": " + text);
  }

  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI response missing b64_json");

  return {
    data: Buffer.from(b64, "base64"),
    contentType: "image/png",
    ext: "png",
  };
}

/**
 * Generate a local SVG placeholder image (offline fallback).
 */
function generateWithSvg(prompt) {
  const palette = pickPalette(prompt);
  const stripped = prompt.replace(/[<>&"']/g, "").slice(0, 60);
  const now = new Date().toISOString();
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">',
    '  <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">',
    '    <stop offset="0%" stop-color="' + palette[0] + '"/>',
    '    <stop offset="100%" stop-color="' + palette[1] + '"/>',
    "  </linearGradient></defs>",
    '  <rect width="1024" height="1024" fill="url(#bg)"/>',
    '  <text x="50%" y="44%" font-family="sans-serif" font-size="48" fill="white" text-anchor="middle" opacity="0.95">Walgent</text>',
    '  <text x="50%" y="54%" font-family="sans-serif" font-size="28" fill="white" text-anchor="middle" opacity="0.85">' +
      stripped + "</text>",
    '  <text x="50%" y="64%" font-family="monospace" font-size="18" fill="white" text-anchor="middle" opacity="0.5">svg-fallback - ' +
      now + "</text>",
    "</svg>",
  ].join("\n");
  return {
    data: Buffer.from(svg, "utf8"),
    contentType: "image/svg+xml",
    ext: "svg",
  };
}

function pickPalette(seed) {
  const palettes = [
    ["#667eea", "#764ba2"],
    ["#0EA5E9", "#6366F1"],
    ["#f093fb", "#f5576c"],
    ["#4facfe", "#00f2fe"],
    ["#43e97b", "#38f9d7"],
    ["#fa709a", "#fee140"],
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return palettes[Math.abs(h) % palettes.length];
}

// ─────────────────────────────────────────────────────────────
// Walrus upload
// ─────────────────────────────────────────────────────────────

async function uploadToWalrus(buf) {
  const res = await fetch(WALRUS_PUBLISHER, {
    method: "PUT",
    body: buf,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Walrus upload HTTP " + res.status + ": " + text);
  }
  const data = await res.json();
  const blobId =
    (data.newlyCreated && data.newlyCreated.blobObject && data.newlyCreated.blobObject.blobId) ||
    (data.alreadyCertified && data.alreadyCertified.blobId);
  if (!blobId) throw new Error("No blobId in Walrus response");
  return { blobId, url: WALRUS_AGGREGATOR_BASE + "/" + blobId };
}

// ─────────────────────────────────────────────────────────────
// Preview HTML
// ─────────────────────────────────────────────────────────────

function saveLocalPreview(imageData, contentType, blobId, url, prompt, providerName) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const ext = contentType.includes("png") ? "png"
    : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg"
    : contentType.includes("svg") ? "svg"
    : "bin";

  // 1. Save the image file
  const imgFile = path.join(OUTPUT_DIR, "image." + ext);
  fs.writeFileSync(imgFile, imageData);

  // 2. data: URL for embedding
  const b64 = imageData.toString("base64");
  const dataUrl = "data:" + contentType + ";base64," + b64;

  // 3. HTML preview
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Walgent Demo - ${providerName}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0F172A; color: #E2E8F0; margin: 0; padding: 32px; min-height: 100vh; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { color: #38BDF8; font-size: 28px; margin-bottom: 4px; }
    h2 { color: #94A3B8; font-size: 16px; font-weight: normal; margin-top: 0; }
    .prompt-box { background: #1E293B; border-left: 3px solid #38BDF8; padding: 12px 16px; border-radius: 8px; margin: 16px 0; font-style: italic; }
    .badge { display: inline-block; background: #10B981; color: #fff; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
    .badge.svg { background: #6366F1; }
    .result { display: flex; gap: 24px; margin: 24px 0; flex-wrap: wrap; }
    .result img { max-width: 100%; width: 400px; height: auto; border-radius: 12px; border: 2px solid #334155; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .info { flex: 1; min-width: 280px; }
    .info dl { margin: 0; }
    .info dt { color: #64748B; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 12px; }
    .info dd { margin: 4px 0 0 0; font-family: monospace; font-size: 13px; word-break: break-all; }
    .info a { color: #60A5FA; }
    .walrus-link { display: inline-block; margin-top: 8px; padding: 8px 16px; background: #0EA5E9; color: #fff !important; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .walrus-link:hover { background: #0284C7; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #1E293B; color: #64748B; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Walgent Demo</h1>
    <h2>AI Agent &rarr; Skill &rarr; Walrus Decentralized Storage</h2>

    <div class="prompt-box">
      <span class="badge ${providerName === 'svg-fallback' ? 'svg' : ''}">${providerName}</span>
      &nbsp; "${prompt}"
    </div>

    <div class="result">
      <img src="${dataUrl}" alt="Generated image">

      <div class="info">
        <dl>
          <dt>Provider</dt>
          <dd>${providerName}</dd>

          <dt>Size</dt>
          <dd>${imageData.length.toLocaleString()} bytes (${contentType})</dd>

          <dt>Blob ID</dt>
          <dd>${blobId}</dd>

          <dt>Walrus URL</dt>
          <dd>${url}</dd>
        </dl>
        <a class="walrus-link" href="${url}" target="_blank">Open Raw Blob &rarr;</a>
      </div>
    </div>

    <div class="footer">
      Generated by Walgent &mdash; the image is permanently stored on the Walrus
      decentralized network. This HTML file embeds the image via a data: URL,
      so it works offline even if the Walrus aggregator is slow.
    </div>
  </div>
</body>
</html>`;

  const htmlFile = path.join(OUTPUT_DIR, "preview.html");
  fs.writeFileSync(htmlFile, html, "utf8");
  return { imgFile, htmlFile };
}

// ─────────────────────────────────────────────────────────────
// Terminal UI helpers
// ─────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(title, color) {
  console.log("");
  console.log(color + C.bold + "── " + title + " " + C.reset);
  await sleep(200);
}

async function info(text, color) {
  console.log("  " + (color || C.gray) + text + C.reset);
  await sleep(150);
}

async function spinner(label, fn) {
  const frames = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write("\r  " + C.cyan + frames[i++ % frames.length] + C.reset + " " + label + "...");
  }, 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write("\r  " + C.green + "\u2714" + C.reset + " " + label + "   \n");
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write("\r  " + C.red + "\u2716" + C.reset + " " + label + "   \n");
    throw e;
  }
}

function openBrowser(absPath) {
  try {
    if (os.platform() === "win32") {
      exec('start "" "' + absPath + '"');
    } else if (os.platform() === "darwin") {
      exec('open "' + absPath + '"');
    } else {
      exec('xdg-open "' + absPath + '"');
    }
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

async function main() {
  const prompt = process.argv[2] || DEFAULT_PROMPT;

  // Decide which provider to use
  const hasGlm = Boolean(
    process.env.ZHIPU_API_KEY ||
    process.env.GLM_API_KEY ||
    process.env.ZHIPUAI_API_KEY
  );
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  let providerName, providerFn, isReal;

  if (hasGlm) {
    providerName = "glm-image";
    providerFn = () => generateWithGlm(prompt);
    isReal = true;
  } else if (hasOpenAI) {
    providerName = "openai (DALL-E 3)";
    providerFn = () => generateWithOpenAI(prompt);
    isReal = true;
  } else {
    providerName = "svg-fallback";
    providerFn = () => Promise.resolve(generateWithSvg(prompt));
    isReal = false;
  }

  // Banner
  console.log("");
  console.log(C.cyan + C.bold + "  \u250c" + "\u2500".repeat(52) + "\u2510" + C.reset);
  console.log(C.cyan + C.bold + "  \u2502" + C.reset + C.bold + "          Walgent Demo \u2014 Agent \u00d7 Walrus          " + C.cyan + C.bold + "\u2502" + C.reset);
  console.log(C.cyan + C.bold + "  \u2514" + "\u2500".repeat(52) + "\u2518" + C.reset);
  console.log(C.gray + "  Provider: " + providerName + (isReal ? " (real AI generation)" : " (offline placeholder)") + C.reset);
  console.log("");

  // Step 0: Input
  await step("Step 1/4  Input", C.blue);
  await info("Prompt: " + C.white + '"' + prompt + '"', C.gray);

  // Step 1: Generate
  await step("Step 2/4  Generate Image via " + providerName, C.magenta);
  await info("Calling " + providerName + "...", C.gray);

  let imageData, contentType;
  try {
    const result = await spinner("Generating image", providerFn);
    imageData = result.data;
    contentType = result.contentType;
  } catch (e) {
    console.log(C.red + "  \u2716 Error: " + e.message + C.reset);
    if (isReal) {
      console.log(C.yellow + "  Falling back to SVG placeholder..." + C.reset);
      const fallback = generateWithSvg(prompt);
      imageData = fallback.data;
      contentType = fallback.contentType;
      providerName = "svg-fallback (error recovery)";
    } else {
      process.exit(1);
    }
  }

  await info("\u2714 Image generated: " + C.white + imageData.length.toLocaleString() + " bytes (" + contentType + ")", C.green);

  // Step 2: Upload
  await step("Step 3/4  Upload to Walrus (testnet)", C.yellow);
  const uploadResult = await spinner("Uploading to Walrus", () => uploadToWalrus(imageData));
  await info("\u2714 Stored permanently on decentralized storage", C.green);
  await info("Blob ID: " + C.white + uploadResult.blobId, C.gray);
  await info("URL: " + C.white + uploadResult.url, C.gray);

  // Step 3: Preview
  await step("Step 4/4  Done", C.green);
  const preview = saveLocalPreview(imageData, contentType, uploadResult.blobId, uploadResult.url, prompt, providerName);

  console.log("");
  console.log(C.green + C.bold + "  \u2705 Success!" + C.reset);
  console.log(C.gray + "  Local file: " + preview.imgFile + C.reset);
  console.log(C.gray + "  Walrus URL: " + uploadResult.url + C.reset);
  console.log("");

  // Open browser
  const absPath = path.resolve(preview.htmlFile);
  await sleep(300);
  console.log(C.cyan + "  Opening preview in browser..." + C.reset);
  openBrowser(absPath);
  await sleep(500);

  console.log("");
  console.log(C.gray + "  Tip: The preview HTML embeds the image via a data: URL," + C.reset);
  console.log(C.gray + "  so it renders correctly even without the Walrus aggregator." + C.reset);
  console.log("");
}

main().catch((e) => {
  console.error(C.red + "\nFatal: " + e.message + C.reset);
  process.exit(1);
});
