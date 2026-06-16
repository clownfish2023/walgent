/**
 * Wallet & Private Key Management
 *
 * ⚠️ Important: Walrus has different payment mechanisms on different networks
 *
 * ┌──────────┬─────────────────────────┬──────────────────────────┐
 * │ Testnet  │ Public, no-auth Publisher       │ No wallet/private key required       │
 * ├──────────┼─────────────────────────┼──────────────────────────┤
 * │ Mainnet  │ No public Publisher             │ Must pay (WAL tokens)                │
 * └──────────┴─────────────────────────┴──────────────────────────┘
 *
 * There are 3 strategies for uploading on Mainnet:
 *
 * 1. [Recommended] Self-hosted Publisher
 *    -    - Run your own Walrus node (including a Sui full node)
 *    -    - Private keys stay on the Publisher; the agent only connects to your private endpoint URL
 *    -    - Highest security: private keys never leave the Publisher process
 *
 * 2. Upload Relay
 *    -    - Use a third-party relay service; they pay WAL on your behalf
 *    -    - The agent only needs the relay URL + API Key
 *
 * 3. On-chain signing (requires @mysten/sui + @mysten/walrus SDK)
 *    -    - The agent directly holds the Sui wallet private key
 *    -    - Directly call Sui contracts to buy WAL and pay
 *    -    - This module supports private key loading for this scenario
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Wallet configuration: determines how to load and manage private keys. */
export interface WalletConfig {
  /**
   * Private key source:
   * - - "env":     Load from environment variable (default)
   * - - "keystore": Load from Sui keystore file
   * - - "external": Externally injected (e.g., hardware wallet/KMS); not loaded by this module
   */
  source?: "env" | "keystore" | "external";

  /**
   * When source="env", the environment variable name to read.
   * Defaults to "WALRUS_SUI_PRIVATE_KEY".
   * Private key format: Sui Bech32 or 0x-prefixed hex.
   */
  envVar?: string;

  /**
   * When source="keystore", the Sui keystore file path.
   * Default ~/.sui/sui_config/sui.keystore
   */
  keystorePath?: string;

  /**
   * When source="keystore", which address index to use (default 0).
   */
  keystoreIndex?: number;

  /**
   * Sui RPC endpoint (for balance queries and broadcasting transactions).
   * Defaults to the official endpoint based on the network.
   */
  suiRpcUrl?: string;
}

/** Default Sui RPC endpoints for each network. */
export const DEFAULT_SUI_RPC: Record<string, string> = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
};

/**
 * Wallet manager: safely loads private keys and queries balance.
 *
 * Design principles:
 *     1. Private keys exist only in memory; never written to logs
 *     2. Supports multiple sources (env, keystore, external injection)
 *     3. Does not sign transactions directly (signing is done by the upper-layer Sui Signer)
 */
export class WalletManager {
  private privateKey: string | null = null;
  private readonly config: Required<
    Omit<WalletConfig, "suiRpcUrl">
  > & { suiRpcUrl?: string };

  constructor(config: WalletConfig = {}) {
    this.config = {
      source: config.source ?? "env",
      envVar: config.envVar ?? "WALRUS_SUI_PRIVATE_KEY",
      keystorePath:
        config.keystorePath ??
        join(homedir(), ".sui", "sui_config", "sui.keystore"),
      keystoreIndex: config.keystoreIndex ?? 0,
      suiRpcUrl: config.suiRpcUrl,
    };
  }

  /**
   * Load the private key (based on the configured source).
   * For the "external" source, inject via setPrivateKey.
   */
  load(): string {
    if (this.privateKey) return this.privateKey;

    switch (this.config.source) {
      case "env":
        return this.loadFromEnv();

      case "keystore":
        return this.loadFromKeystore();

      case "external":
        if (!this.privateKey) {
          throw new Error(
            'Wallet source is "external" but no private key was injected. ' +
              "Call setPrivateKey() before using the wallet.",
          );
        }
        return this.privateKey;

      default:
        throw new Error(`Unknown wallet source: ${this.config.source}`);
    }
  }

  /**
   * Directly inject a private key (for external source or testing).
   */
  setPrivateKey(key: string): void {
    this.validatePrivateKey(key);
    this.privateKey = key;
  }

  /**
   * Load the private key from an environment variable.
   */
  private loadFromEnv(): string {
    const key = process.env[this.config.envVar];
    if (!key) {
      throw new Error(
        `Private key not found in environment variable "${this.config.envVar}".\n` +
          `Set it with: export ${this.config.envVar}="your-sui-private-key"`,
      );
    }
    this.validatePrivateKey(key);
    this.privateKey = key;
    return key;
  }

  /**
   * Load the private key from a Sui keystore file.
   * A Sui keystore is a JSON array; each element is a base64-encoded key.
   */
  private loadFromKeystore(): string {
    const path = resolve(this.config.keystorePath);
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch {
      throw new Error(
        `Cannot read keystore at ${path}.\n` +
          "Sui keystore is typically at ~/.sui/sui_config/sui.keystore",
      );
    }

    let entries: unknown;
    try {
      entries = JSON.parse(raw);
    } catch {
      throw new Error(`Keystore at ${path} is not valid JSON.`);
    }

    if (!Array.isArray(entries)) {
      throw new Error("Keystore must be a JSON array of keys.");
    }

    const idx = this.config.keystoreIndex;
    if (idx >= entries.length) {
      throw new Error(
        `Keystore index ${idx} out of range (only ${entries.length} keys).`,
      );
    }

    const key = String(entries[idx]);
    this.privateKey = key;
    return key;
  }

  /**
   * Validate the private key format (basic check; no cryptographic verification).
   */
  private validatePrivateKey(key: string): void {
    if (key.startsWith("suiprivkey")) {
      // Bech32 format, the standard format exported by Sui CLI
      return;
    }
    if (key.startsWith("0x") && key.length >= 64) {
      // Hex format
      return;
    }
    // Base64 format (as in keystore; may contain = padding)
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(key) && key.length >= 40) {
      return;
    }
    throw new Error(
      "Invalid private key format. Expected suiprivkey..., 0x-hex, or base64.",
    );
  }

  /**
   * Return masked address info (for logging; excludes private key).
   */
  getSafeDescription(): string {
    try {
      const key = this.privateKey ?? "(not loaded)";
      if (key.startsWith("suiprivkey")) {
        return `suiprivkey1...${key.slice(-4)}`;
      }
      if (key.startsWith("0x")) {
        return `0x...${key.slice(-4)}`;
      }
      return `base64(len=${key.length})`;
    } catch {
      return "(error)";
    }
  }

  /**
   * Query the GAS (SUI) balance of a Sui address (in MIST).
   *
   * Note: actual querying requires a Sui RPC. This returns a placeholder implementation;
   * the upper layer can inject a custom RPC client.
   *
   * @param address A Sui address. If not provided, the wallet's own address is used.
   * @returns SUI balance (MIST = 10^-9 SUI)
   */
  async getBalance(address?: string): Promise<bigint> {
    const rpc = this.config.suiRpcUrl ?? DEFAULT_SUI_RPC.mainnet;
    const target = address ?? "self";

    // Uses native fetch to call the Sui RPC suix_getBalance.
    // For production, use SuiClient from @mysten/sui.js.
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getBalance",
        params: [target, "0x2::sui::SUI"],
      }),
    });

    if (!res.ok) {
      throw new Error(`Sui RPC error: ${res.status}`);
    }

    const json = (await res.json()) as {
      result?: { totalBalance?: string };
      error?: { message?: string };
    };

    if (json.error) {
      throw new Error(`Sui RPC error: ${json.error.message}`);
    }

    return BigInt(json.result?.totalBalance ?? "0");
  }

  /**
   * Check whether the balance is sufficient (rough estimate).
   * Walrus costs approximately 1000-5000 MIST per blob per epoch.
   */
  hasEnoughBalance(
    balance: bigint,
    blobSizeBytes: number,
    epochs: number,
  ): boolean {
    // Rough estimate: ~500_000 MIST per MB per epoch
    // Actual cost is determined on-chain; this is just a pre-check
    const estimatedCost =
      BigInt(Math.ceil(blobSizeBytes / 1_000_000) + 1) *
      BigInt(500_000) *
      BigInt(epochs);
    return balance >= estimatedCost;
  }

  /** Get the configured Sui RPC URL. */
  getSuiRpcUrl(): string {
    return this.config.suiRpcUrl ?? DEFAULT_SUI_RPC.mainnet;
  }
}

/**
 * Create a wallet manager from an environment variable (convenience factory).
 */
export function createWalletFromEnv(
  envVar = "WALRUS_SUI_PRIVATE_KEY",
): WalletManager {
  return new WalletManager({ source: "env", envVar });
}

/**
 * Create a wallet manager from a Sui keystore (convenience factory).
 */
export function createWalletFromKeystore(
  keystorePath?: string,
  index = 0,
): WalletManager {
  return new WalletManager({ source: "keystore", keystorePath, keystoreIndex: index });
}