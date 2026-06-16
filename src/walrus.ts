/**
 * Walrus Client Implementation
 *
 * Wraps the HTTP APIs of the Walrus Publisher (upload) and Aggregator (read).
 * Reference: https://docs.wal.app
 *
 * Main API:
 *   - client.upload(blob, options)
 *   - client.read(blobId)
 *   - client.readUrl(blobId)
 *   - client.exists(blobId)
 */

import type {
  ReadOptions,
  UploadOptions,
  UploadResult,
  WalrusClientConfig,
  WalrusNetwork,
} from "./types.js";

/**
 * Default Publisher / Aggregator endpoints for each network.
 *
 * Note: Walrus official endpoints may change over time. If the default endpoints are unreachable,
 * you can specify custom endpoints via the WALRUS_PUBLISHER_URL / WALRUS_AGGREGATOR_URL
 * environment variables or via WalrusClientConfig.
 *
 * Test whether endpoints are reachable with the following commands:
 *   node -e "fetch('https://YOUR_HOST').then(r=>console.log(r.status)).catch(e=>console.log(e.message))"
 */
const DEFAULT_ENDPOINTS: Record<
  WalrusNetwork,
  { publisher: string; aggregator: string }
> = {
  // Source: https://docs.wal.app/network-reference
  // Mainnet has no public no-auth publisher; you need to self-host or use an upload relay
  mainnet: {
    publisher: "https://publisher.walrus-mainnet.walrus.space",
    aggregator: "https://aggregator.walrus-mainnet.walrus.space",
  },
  testnet: {
    publisher: "https://publisher.walrus-testnet.walrus.space",
    aggregator: "https://aggregator.walrus-testnet.walrus.space",
  },
  // Walrus no longer operates a public Devnet; use Testnet instead
  devnet: {
    publisher: "https://publisher.walrus-testnet.walrus.space",
    aggregator: "https://aggregator.walrus-testnet.walrus.space",
  },
};

/**
 * Walrus client: communicates with the Publisher/Aggregator.
 *
 * Working modes:
 *   - Testnet: connect directly to the public Publisher; no auth required
 *   - Mainnet: specify a private Publisher URL or relay (with API Key)
 */
export class WalrusClient {
  private readonly publisherUrl: string;
  private readonly aggregatorUrl: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly network: WalrusNetwork;
  private readonly relayApiKey?: string;
  private readonly relayAuthHeader: string;

  constructor(config: WalrusClientConfig = {}) {
    const network = config.network ?? "testnet";
    const endpoints = DEFAULT_ENDPOINTS[network];

    this.network = network;
    this.publisherUrl = (config.publisherUrl ?? endpoints.publisher).replace(
      /\/$/,
      "",
    );
    this.aggregatorUrl = (
      config.aggregatorUrl ?? endpoints.aggregator
    ).replace(/\/$/, "");
    this.timeout = config.timeout ?? 60_000;
    this.retries = config.retries ?? 3;
    this.fetchImpl = config.fetch ?? fetch;
    this.relayApiKey = config.relayApiKey;
    this.relayAuthHeader = config.relayAuthHeader ?? "X-API-Key";

    // Mainnet safety check: warn if no relayApiKey or custom publisherUrl
    if (network === "mainnet" && !config.relayApiKey && !config.publisherUrl) {
      console.warn(
        "[WalrusClient] ⚠️ Mainnet mode but no relayApiKey or custom publisherUrl configured.\n" +
          "  Mainnet has no public no-auth Publisher. Please:\n" +
          "  1. Self-host a Publisher and set publisherUrl, or\n" +
          "  2. Use an Upload Relay and set relayApiKey",
      );
    }
  }

  /** Return the current network type. */
  getNetwork(): WalrusNetwork {
    return this.network;
  }

  /** Return the current publisher base URL. */
  getPublisherUrl(): string {
    return this.publisherUrl;
  }

  /** Return the current aggregator base URL. */
  getAggregatorUrl(): string {
    return this.aggregatorUrl;
  }

  /** Whether running in Mainnet mode. */
  isMainnet(): boolean {
    return this.network === "mainnet";
  }

  /**
   * Upload binary data to Walrus.
   *
   * @param data The bytes to upload.
   * @param options Upload options.
   */
  async upload(
    data: Uint8Array,
    options: UploadOptions = {},
  ): Promise<UploadResult> {
    if (data.length === 0) {
      throw new Error("Cannot upload empty data to Walrus.");
    }

    const url = new URL(`/v1/blobs`, this.publisherUrl);

    // Storage duration (epochs): default 1
    if (options.epochs != null) {
      url.searchParams.set("epochs", String(options.epochs));
    }

    // Blob type: permanent takes precedence over deletable
    if (options.permanent) {
      url.searchParams.set("permanent", "true");
    } else if (options.deletable === false) {
      // Explicitly marked non-deletable => permanent
      url.searchParams.set("permanent", "true");
    } else {
      // Default deletable (Walrus default behavior)
      url.searchParams.set("deletable", "true");
    }

    // Send the Blob object to the specified address
    if (options.sendObjectTo) {
      url.searchParams.set("send_object_to", options.sendObjectTo);
    }

    // Build headers (including relay auth)
    const headers: Record<string, string> = {
      "Content-Type": options.contentType ?? "application/octet-stream",
      ...options.headers,
    };

    // If a relay API Key is configured, add the auth header
    if (this.relayApiKey) {
      const headerName = this.relayAuthHeader;
      const value =
        headerName.toLowerCase() === "authorization"
          ? `Bearer ${this.relayApiKey}`
          : this.relayApiKey;
      headers[headerName] = value;
    }

    const response = await this.requestWithRetry("PUT", url, data, headers);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Walrus upload failed: ${response.status} ${response.statusText}${
          body ? ` - ${body}` : ""
        }`,
      );
    }

    const json = (await response.json()) as UploadResult;

    // Normalize: ensure at least newlyCreated or alreadyCertified is present.
    if (!json.newlyCreated && !json.alreadyCertified) {
      throw new Error(
        "Walrus upload returned unexpected payload: missing blob info.",
      );
    }

    return json;
  }

  /**
   * Read raw blob data from Walrus.
   *
   * @param blobId The target blob ID.
   */
  async read(blobId: string, options: ReadOptions = {}): Promise<Uint8Array> {
    const url = this.readUrl(blobId, options);
    const response = await this.requestWithRetry(
      "GET",
      new URL(url),
      undefined,
      options.headers ?? {},
    );

    if (!response.ok) {
      throw new Error(
        `Walrus read failed: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  /**
   * Return the Aggregator URL for reading a blob (no request is made).
   */
  readUrl(blobId: string, options: ReadOptions = {}): string {
    const suffix = options.suffix === true ? "/blob" : "";
    return `${this.aggregatorUrl}/v1/blobs/${encodeURIComponent(
      blobId,
    )}${suffix}`;
  }

  /**
   * Check whether a blob already exists on the Walrus network.
   * Note: this is a best-effort check based on the Aggregator's status code.
   */
  async exists(blobId: string): Promise<boolean> {
    const url = new URL(this.readUrl(blobId));
    try {
      const res = await this.fetchImpl(url.toString(), { method: "HEAD" });
      return res.ok || res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Parse the blobId from a read URL (if possible).
   */
  static parseBlobIdFromUrl(url: string): string | null {
    try {
      const u = new URL(url);
      const match = u.pathname.match(/\/v1\/blobs\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Request method with retries.
   * Retries only on network/5xx errors; 4xx is returned directly.
   */
  private async requestWithRetry(
    method: string,
    url: URL,
    body: Uint8Array | undefined,
    headers: Record<string, string>,
  ): Promise<Response> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const res = await this.fetchImpl(url.toString(), {
          method,
          headers,
          body: body as BodyInit,
          signal: controller.signal,
          // duplex is only used in Node; ignored in browsers
          ...(body ? { duplex: "half" } : {}),
        });
        clearTimeout(timer);

        // Do not retry on 4xx.
        if (res.status >= 400 && res.status < 500) {
          return res;
        }
        // Return directly on 5xx or success (5xx is judged by the caller).
        return res;
      } catch (err) {
        clearTimeout(timer);
        lastError = err;
        // Exponential backoff
        const delay = Math.min(500 * 2 ** attempt, 4_000);
        await sleep(delay);
      }
    }

    throw new Error(
      `Walrus request failed after ${this.retries + 1} attempts: ${
        (lastError as Error)?.message ?? String(lastError)
      }`,
    );
  }
}

/** Utility: sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}