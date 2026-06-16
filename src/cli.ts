#!/usr/bin/env node
/**
 * walrus-skill CLI
 *
 * Provides command-line capabilities to operate Walrus:
 *   - upload <file>           Upload a file to Walrus
 *   - read <blobId>           Read and output blob content
 *   - url <blobId>            Print the read URL
 *   - exists <blobId>         Check if a blob exists
 *   - run <skill>             Run a built-in example skill (see examples/)
 *
 * Environment variables:
 *   WALRUS_NETWORK            mainnet | testnet | devnet (default testnet)
 *   WALRUS_PUBLISHER_URL      Custom publisher
 *   WALRUS_AGGREGATOR_URL     Custom aggregator
 *   WALRUS_EPOCHS             Upload epochs (default 5)
 */

import { writeFile } from "node:fs/promises";
import {
  extractBlobId,
  extractBlobObjectId,
  extractEndEpoch,
} from "./types.js";
import { WalrusClient } from "./walrus.js";
import { readBinaryFile, guessContentType } from "./utils.js";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        args[key] = val;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

function networkFromEnv():
  | "mainnet"
  | "testnet"
  | "devnet" {
  const n = (process.env.WALRUS_NETWORK ?? "testnet").toLowerCase();
  if (n !== "mainnet" && n !== "testnet" && n !== "devnet") {
    throw new Error(`Unknown WALRUS_NETWORK: ${n}`);
  }
  return n;
}

function createClient(): WalrusClient {
  return new WalrusClient({
    network: networkFromEnv(),
    publisherUrl: process.env.WALRUS_PUBLISHER_URL,
    aggregatorUrl: process.env.WALRUS_AGGREGATOR_URL,
  });
}

function printHelp(): void {
  console.log(`walrus-skill CLI

Usage:
  walrus-skill upload <file> [--epochs N] [--out <path>]
  walrus-skill read <blobId> [--out <path>]
  walrus-skill url <blobId>
  walrus-skill exists <blobId>
  walrus-skill help

Environment:
  WALRUS_NETWORK            mainnet | testnet | devnet (default: testnet)
  WALRUS_PUBLISHER_URL      custom publisher base URL
  WALRUS_AGGREGATOR_URL     custom aggregator base URL
  WALRUS_EPOCHS             default epochs for uploads (default: 5)
`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);
  const positional = rest.filter((r) => !r.startsWith("--"));

  try {
    switch (cmd) {
      case "upload": {
        const file = positional[0];
        if (!file) {
          throw new Error("Missing <file> argument.");
        }
        const client = createClient();
        const data = await readBinaryFile(file);
        const epochs = Number(flags.epochs ?? process.env.WALRUS_EPOCHS ?? 5);
        const contentType = guessContentType(file);
        const res = await client.upload(data, { epochs, contentType });

        const blobId = extractBlobId(res);
        const summary = {
          blobId,
          blobObjectId: extractBlobObjectId(res),
          endEpoch: extractEndEpoch(res),
          newlyCreated: Boolean(res.newlyCreated),
          url: client.readUrl(blobId),
        };
        const text = JSON.stringify(summary, null, 2);
        if (flags.out) {
          await writeFile(flags.out, text, "utf-8");
          console.log(`Wrote result to ${flags.out}`);
        } else {
          console.log(text);
        }
        break;
      }

      case "read": {
        const blobId = positional[0];
        if (!blobId) throw new Error("Missing <blobId> argument.");
        const client = createClient();
        const data = await client.read(blobId);
        if (flags.out) {
          await writeFile(flags.out, data);
          console.log(`Wrote ${data.length} bytes to ${flags.out}`);
        } else {
          process.stdout.write(data);
        }
        break;
      }

      case "url": {
        const blobId = positional[0];
        if (!blobId) throw new Error("Missing <blobId> argument.");
        const client = createClient();
        console.log(client.readUrl(blobId));
        break;
      }

      case "exists": {
        const blobId = positional[0];
        if (!blobId) throw new Error("Missing <blobId> argument.");
        const client = createClient();
        const exists = await client.exists(blobId);
        console.log(exists ? "true" : "false");
        process.exitCode = exists ? 0 : 1;
        break;
      }

      case "help":
      case "--help":
      case "-h":
      case undefined:
        printHelp();
        break;

      default:
        console.error(`Unknown command: ${cmd}`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

main();