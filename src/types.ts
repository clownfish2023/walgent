/**
 * Walrus Skill - Type Definitions
 *
 * All public types needed for the Walrus client, Skill, and Agent interactions are defined here.
 */

/** Walrus network environment. */
export type WalrusNetwork = "mainnet" | "testnet" | "devnet";

/**
 * Walrus client configuration.
 *
 * You can directly specify publisher/aggregator URLs,
 * or just specify the network to use official default endpoints.
 *
 * ⚠️ Mainnet notes:
 *     Mainnet has no public no-auth Publisher.
 *     You must provide payment capability via one of the following:
 *   -   - publisherUrl points to your self-hosted Publisher (private key on the Publisher side)
 *   -   - publisherUrl points to an Upload Relay service
 *   -   - Inject a wallet for on-chain signing payment (requires @mysten/walrus SDK)
 */
export interface WalrusClientConfig {
  /** Network environment. */
  network?: WalrusNetwork;
  /**
   * Publisher base URL (for uploads).
   * Takes precedence over the network default.
   *
   * Required on Mainnet (point to your private Publisher or relay).
   */
  publisherUrl?: string;
  /**
   * Aggregator base URL (for reads).
   * Takes precedence over the network default.
   */
  aggregatorUrl?: string;
  /** HTTP request timeout in ms; default 60_000. */
  timeout?: number;
  /** Number of retries; default 3. */
  retries?: number;
  /** Custom HTTP request function (for testing or proxying). */
  fetch?: typeof fetch;
  /**
   * [Mainnet] Upload Relay API Key (if using a relay service).
   * When set, an Authorization header is added to upload requests.
   */
  relayApiKey?: string;
  /**
   * [Mainnet] The authentication header name for Upload Relay.
   * Defaults to "X-API-Key". Can also be set to "Authorization" for a Bearer token.
   */
  relayAuthHeader?: string;
}

/** Blob upload parameters. */
export interface UploadOptions {
  /** Storage duration in epochs. Defaults to 1 epoch if not specified. */
  epochs?: number;
  /**
   * Blob type:
   * - - "deletable": deletable (default)
   * - - "permanent": permanent
   * If not specified, Walrus defaults to creating a deletable blob.
   */
  deletable?: boolean;
  /**
   * Whether to mark the blob as permanent.
   * Mutually exclusive with deletable; permanent takes precedence if both are set.
   */
  permanent?: boolean;
  /** Send the Blob object to the specified Sui address. */
  sendObjectTo?: string;
  /** Custom Content-Type. */
  contentType?: string;
  /** Additional metadata sent via HTTP headers. */
  headers?: Record<string, string>;
}

/** Blob object (on-chain object returned by Walrus). */
export interface BlobObject {
  /** Sui object ID. */
  id: string;
  /** Registration epoch. */
  registeredEpoch: number;
  /** Blob ID。 */
  blobId: string;
  /** Original blob size in bytes. */
  size: number;
  /** Encoding type, e.g. "RS2". */
  encodingType: string;
  /** Certification epoch (may be null when newly created and uncertified). */
  certifiedEpoch: number | null;
  /** Storage information. */
  storage: {
    /** Storage object ID. */
    id: string;
    /** Storage start epoch. */
    startEpoch: number;
    /** Storage end epoch. */
    endEpoch: number;
    /** Storage size in bytes. */
    storageSize: number;
  };
  /** Whether deletable. */
  deletable: boolean;
}

/** Blob upload result. */
export interface UploadResult {
  /** Newly created blob (only present when newly created). */
  newlyCreated?: {
    /** Blob object. */
    blobObject: BlobObject;
    /** Resource operation info. */
    resourceOperation?: unknown;
    /** Upload cost (MIST). */
    cost?: number;
  };
  /** Already certified existing blob (returned when content is identical and already exists). */
  alreadyCertified?: {
    /** Blob ID。 */
    blobId: string;
    /** The end epoch of paid storage. */
    endEpoch: number;
    /** Whether certified. */
    certified: boolean;
    /** Blob object ID. */
    blobObjectId: string;
  };
}

/**
 * Extract the blobId from an UploadResult.
 */
export function extractBlobId(result: UploadResult): string {
  if (result.newlyCreated) {
    return result.newlyCreated.blobObject.blobId;
  }
  if (result.alreadyCertified) {
    return result.alreadyCertified.blobId;
  }
  throw new Error("Cannot extract blobId: invalid upload result.");
}

/**
 * Extract the blob object ID (Sui object id) from an UploadResult.
 */
export function extractBlobObjectId(result: UploadResult): string {
  if (result.newlyCreated) {
    return result.newlyCreated.blobObject.id;
  }
  if (result.alreadyCertified) {
    return result.alreadyCertified.blobObjectId;
  }
  throw new Error("Cannot extract blobObjectId: invalid upload result.");
}

/**
 * Extract the storage end epoch from an UploadResult.
 */
export function extractEndEpoch(result: UploadResult): number {
  if (result.newlyCreated) {
    return result.newlyCreated.blobObject.storage.endEpoch;
  }
  if (result.alreadyCertified) {
    return result.alreadyCertified.endEpoch;
  }
  throw new Error("Cannot extract endEpoch: invalid upload result.");
}

/** Options for reading a Blob. */
export interface ReadOptions {
  /** Whether to force the `_blob` suffix in the URL (needed by some aggregators). */
  suffix?: boolean;
  /** Custom request headers. */
  headers?: Record<string, string>;
}

/** Skill metadata. */
export interface SkillInfo {
  /** Unique identifier of the Skill. */
  name: string;
  /** Human-readable name. */
  title: string;
  /** Short description. */
  description: string;
  /** Version number. */
  version: string;
  /** Tags. */
  tags?: string[];
}

/** Skill processing context. */
export interface SkillContext {
  /** User input text / instruction. */
  input: string;
  /** Attachment data (e.g., binary files). */
  attachments?: Attachment[];
  /** User-provided configuration / parameters. */
  params?: Record<string, unknown>;
}

/** Attachment. */
export interface Attachment {
  /** Filename. */
  filename: string;
  /** MIME type. */
  contentType?: string;
  /** Binary data. */
  data: Uint8Array;
}

/** Skill processing result. */
export interface SkillResult {
  /** Whether successful. */
  ok: boolean;
  /** Output text (returned to the agent). */
  message: string;
  /** Outputs (data to be stored on Walrus). */
  outputs?: OutputArtifact[];
  /** Raw data for further agent processing. */
  data?: Record<string, unknown>;
  /** Error message (when ok=false). */
  error?: string;
}

/** Output artifact. */
export interface OutputArtifact {
  /** Filename. */
  filename: string;
  /** MIME type. */
  contentType?: string;
  /** Binary data. */
  data: Uint8Array;
}

/** Artifact uploaded to Walrus (includes blob info). */
export interface StoredArtifact extends OutputArtifact {
  /** Walrus blob ID。 */
  blobId: string;
  /** Blob object ID. */
  blobObjectId?: string;
  /** Aggregator URL to read this blob. */
  url: string;
  /** Storage end epoch. */
  endEpoch?: number;
}

/** Agent run result. */
export interface AgentRunResult {
  /** Skill metadata. */
  skill: SkillInfo;
  /** Local processing result. */
  result: SkillResult;
  /** Artifacts uploaded to Walrus. */
  stored: StoredArtifact[];
}