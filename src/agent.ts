/**
 * WalrusAgent
 *
 * Combines the Skill processing flow with the Walrus storage flow:
 *   1. Call the Skill to process the input, producing a SkillResult (including outputs)
 *   2. Automatically upload each output to Walrus
 *   3. Return a complete result containing blobId / read URL
 *
 * This is the core abstraction for "letting an agent access Walrus via skills."
 */

import type { Skill } from "./skill.js";
import type { WalletConfig } from "./wallet.js";
import { WalletManager } from "./wallet.js";
import {
  extractBlobId,
  extractBlobObjectId,
  extractEndEpoch,
} from "./types.js";
import type {
  AgentRunResult,
  OutputArtifact,
  SkillContext,
  StoredArtifact,
  UploadOptions,
  WalrusClientConfig,
} from "./types.js";
import { WalrusClient } from "./walrus.js";

/** WalrusAgent constructor options. */
export interface WalrusAgentOptions {
  /** Walrus client configuration. */
  walrus?: WalrusClientConfig;
  /**
   * Default parameters for uploads (epochs, deletable, etc.).
   * Can be overridden by individual output metadata.
   */
  uploadDefaults?: UploadOptions;
  /** Whether to return (not throw) on Skill failure; defaults to true. */
  graceful?: boolean;
  /**
   * Optional: called before uploading each output; return false to skip it.
   */
  onBeforeUpload?: (artifact: OutputArtifact) => boolean | Promise<boolean>;
  /**
   * [Mainnet] Wallet configuration.
   *
   * Used in Mainnet mode for:
   *   - Loading private keys (from env/keystore/external)
   *   - Checking balance before upload
   *
   * Can be ignored in Testnet mode.
   */
  wallet?: WalletConfig;
  /**
   * [Mainnet] Whether to check balance before upload; defaults to true.
   * Only takes effect when wallet is configured.
   */
  checkBalanceBeforeUpload?: boolean;
}

/**
 * WalrusAgent: the orchestrator of Skill + Walrus storage.
 */
export class WalrusAgent {
  private readonly client: WalrusClient;
  private readonly skills = new Map<string, Skill>();
  private readonly uploadDefaults: UploadOptions;
  private readonly graceful: boolean;
  private readonly onBeforeUpload?: WalrusAgentOptions["onBeforeUpload"];
  private readonly walletManager?: WalletManager;
  private readonly checkBalance: boolean;

  constructor(options: WalrusAgentOptions = {}) {
    this.client = new WalrusClient(options.walrus ?? {});
    this.uploadDefaults = options.uploadDefaults ?? {};
    this.graceful = options.graceful ?? true;
    this.onBeforeUpload = options.onBeforeUpload;

    // Wallet initialization (mainly for Mainnet)
    if (options.wallet) {
      this.walletManager = new WalletManager(options.wallet);
      this.checkBalance = options.checkBalanceBeforeUpload ?? true;
    } else {
      this.checkBalance = false;
    }
  }

  /** Get the internal wallet manager (if configured). */
  get wallet(): WalletManager | undefined {
    return this.walletManager;
  }

  /** Get the internal WalrusClient (for direct read/write). */
  get walrus(): WalrusClient {
    return this.client;
  }

  /** Register a Skill. */
  register(skill: Skill): this {
    const name = skill.info().name;
    if (this.skills.has(name)) {
      throw new Error(`Skill "${name}" already registered.`);
    }
    this.skills.set(name, skill);
    return this;
  }

  /** Unregister a Skill. */
  unregister(name: string): this {
    this.skills.delete(name);
    return this;
  }

  /** List registered Skills. */
  list(): Skill[] {
    return [...this.skills.values()];
  }

  /**
   * Execute a Skill and automatically upload its outputs to Walrus.
   *
   * @param skillName The name of the Skill to execute.
   * @param ctx The input context.
   */
  async run(
    skillName: string,
    ctx: SkillContext,
  ): Promise<AgentRunResult> {
    const skill = this.skills.get(skillName);
    if (!skill) {
      throw new Error(
        `Skill "${skillName}" not registered. Available: ${[
          ...this.skills.keys(),
        ].join(", ")}`,
      );
    }

    // 1. Execute the Skill
    let result;
    try {
      result = await skill.run(ctx);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      if (!this.graceful) throw err;
      return {
        skill: skill.info(),
        result: { ok: false, message, error: message },
        stored: [],
      };
    }

    // 2. Upload outputs to Walrus
    const stored: StoredArtifact[] = [];
    const outputs = result.outputs ?? [];

    for (const output of outputs) {
      try {
        // Allow external interception
        if (this.onBeforeUpload) {
          const allow = await this.onBeforeUpload(output);
          if (!allow) continue;
        }

        const storedItem = await this.uploadArtifact(output);
        stored.push(storedItem);
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        if (!this.graceful) throw err;
        // Record upload failures without interrupting the flow
        result.data = {
          ...(result.data ?? {}),
          uploadErrors: [
            ...((result.data?.uploadErrors as string[]) ?? []),
            `${output.filename}: ${message}`,
          ],
        };
      }
    }

    return {
      skill: skill.info(),
      result,
      stored,
    };
  }

  /**
   * Roughly estimate the upload cost (MIST).
   * Formula: ~500_000 MIST per MB per epoch
   */
  private estimateCost(sizeBytes: number, epochs: number): bigint {
    return (
      BigInt(Math.ceil(sizeBytes / 1_000_000) + 1) *
      BigInt(500_000) *
      BigInt(epochs)
    );
  }

  /**
   * Internal method: upload a single output to Walrus.
   * If wallet is configured and checkBalance is enabled, the balance is checked first.
   */
  private async uploadArtifact(
    artifact: OutputArtifact,
  ): Promise<StoredArtifact> {
    // Mainnet balance pre-check
    if (this.walletManager && this.checkBalance && this.client.isMainnet()) {
      try {
        const balance = await this.walletManager.getBalance();
        const epochs = this.uploadDefaults.epochs ?? 1;
        if (!this.walletManager.hasEnoughBalance(balance, artifact.data.length, epochs)) {
          throw new Error(
            `Insufficient balance for upload. ` +
              `Have ${balance} MIST, need ~${this.estimateCost(artifact.data.length, epochs)} MIST ` +
              `for ${artifact.data.length} bytes × ${epochs} epochs.`,
          );
        }
      } catch (err) {
        // Balance query failure does not block (could be an RPC issue); just warn
        if (this.graceful) {
          console.warn(
            `[WalrusAgent] Balance check skipped: ${(err as Error).message}`,
          );
        } else {
          throw err;
        }
      }
    }

    const uploadRes = await this.client.upload(artifact.data, {
      ...this.uploadDefaults,
      contentType: artifact.contentType,
    });

    const blobId = extractBlobId(uploadRes);
    const blobObjectId = extractBlobObjectId(uploadRes);
    const endEpoch = extractEndEpoch(uploadRes);

    return {
      ...artifact,
      blobId,
      blobObjectId,
      endEpoch,
      url: this.client.readUrl(blobId),
    };
  }
}
