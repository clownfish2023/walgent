/**
 * walrus-skill
 *
 * Let AI agents access Walrus decentralized storage via Skills.
 *
 * Core exports:
 *   - WalrusClient      Low-level HTTP client (upload/read)
 *   - WalrusAgent       Orchestrator: runs Skills and auto-uploads outputs
 *   - Skill interface    Define capability units
 *   - Types              Complete TypeScript type definitions
 *
 * Quick start:
 *   import { WalrusAgent, createSkill } from "walrus-skill";
 */

export { WalrusClient } from "./walrus.js";
export { WalrusAgent } from "./agent.js";
export type { WalrusAgentOptions } from "./agent.js";
export type { Skill } from "./skill.js";
export { FunctionSkill, defineSkill, createSkill } from "./skill.js";
export {
  WalletManager,
  createWalletFromEnv,
  createWalletFromKeystore,
  DEFAULT_SUI_RPC,
} from "./wallet.js";
export type { WalletConfig } from "./wallet.js";
export {
  readBinaryFile,
  toBytes,
  fromBytes,
  guessContentType,
  toHex,
} from "./utils.js";

export type {
  WalrusNetwork,
  WalrusClientConfig,
  UploadOptions,
  UploadResult,
  BlobObject,
  ReadOptions,
  SkillInfo,
  SkillContext,
  SkillResult,
  Attachment,
  OutputArtifact,
  StoredArtifact,
  AgentRunResult,
} from "./types.js";
export {
  extractBlobId,
  extractBlobObjectId,
  extractEndEpoch,
} from "./types.js";
