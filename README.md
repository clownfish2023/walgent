<div align="center">
  <img src="assets/icon.svg" width="100" height="100" alt="Walgent">
</div>

# Walgent

> **Decentralized storage for AI agents.** Let AI agents store outputs on Walrus decentralized storage via Skills.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-blue.svg)](https://nodejs.org/)

`Walgent` (**Wal**rus + A**gent**) is a lightweight TypeScript toolkit that provides a clean abstraction allowing any AI agent to:

1. **Define a Skill** (a capability unit, e.g. "generate image" or "summarize document")
2. **Run a Skill to produce data** (images, text, JSON, etc.)
3. **Automatically upload outputs to Walrus** (decentralized, permanent storage)
4. **Get a shareable Walrus access URL**

For example: an "image generation agent" can automatically store the generated image on Walrus and return a decentralized URL accessible by anyone.

---

## ✨ Features

- 🧩 **Skill Abstraction**: Define agent capabilities with a unified interface, decoupling business logic from storage
- 🗃️ **Auto Upload**: After an agent runs, outputs are automatically stored on Walrus — zero boilerplate
- 🌐 **Multi-Network**: Supports mainnet / testnet / devnet with custom endpoints
- 🔁 **Retry & Timeout**: Built-in exponential backoff retries and request timeout control
- 🛡️ **Type Safe**: Complete TypeScript type definitions
- 🖥️ **CLI Tool**: Upload / read / check blobs directly from the command line
- 🧪 **Testable**: Supports custom fetch for easy unit testing

---

## 📦 Installation

```bash
npm install walgent
# or
yarn add walgent
# or
pnpm add walgent
```

> Local development:
> ```bash
> git clone <repo>
> cd walskill
> npm install
> npm test
> ```

---

## 🚀 Quick Start

### Scenario: Image generation agent auto-stores to Walrus

```typescript
import { WalrusAgent, createSkill, toBytes } from "walgent";

// 1. Define an "image generation" Skill
const imageGenSkill = createSkill(
  {
    name: "image-gen",
    title: "Image Generator",
    description: "Generate an image from a prompt",
    version: "0.1.0",
  },
  async (ctx) => {
    const prompt = ctx.input;
    // Call your AI image generation API here (OpenAI, Stable Diffusion, etc.)
    const imageBytes = await generateImage(prompt); // your function

    return {
      ok: true,
      message: `Generated image for "${prompt}"`,
      outputs: [
        {
          filename: `image-${Date.now()}.png`,
          contentType: "image/png",
          data: imageBytes,
        },
      ],
    };
  },
);

// 2. Create an Agent and register the Skill
const agent = new WalrusAgent({
  walrus: { network: "testnet" },
  uploadDefaults: { epochs: 5 },
});
agent.register(imageGenSkill);

// 3. Run! The agent will automatically upload the image to Walrus
const result = await agent.run("image-gen", {
  input: "a cat sitting on a blockchain",
});

// 4. Get the Walrus access URL
console.log(result.stored[0].url);
// => https://aggregator.walrus-testnet.walrus.space/v1/blobs/0x...
console.log(result.stored[0].blobId);
// => 0xabc123...
```

---

## 📚 Core API

### `WalrusAgent`

The orchestrator: runs Skills and automatically uploads outputs.

```typescript
const agent = new WalrusAgent({
  walrus: { network: "testnet" },        // Walrus client config
  uploadDefaults: { epochs: 5 },          // Default upload parameters
  graceful: true,                         // Return instead of throwing on Skill failure (default true)
  onBeforeUpload: (artifact) => true,    // Pre-upload interception hook
});

agent.register(skill);                    // Register a Skill
agent.unregister("skill-name");           // Unregister a Skill
agent.list();                             // List all registered Skills
const result = await agent.run("skill-name", { input: "..." });  // Run
agent.walrus;                             // Direct access to WalrusClient
```

### `WalrusClient`

The low-level HTTP client for direct Walrus operations.

```typescript
import { WalrusClient } from "walgent";

const client = new WalrusClient({ network: "testnet" });

// Upload
const res = await client.upload(bytes, {
  epochs: 5,
  contentType: "image/png",
  mode: "deterministic",  // or "random"
});
// res.newlyCreated.blobId  or  res.alreadyCertified.blobId

// Read
const data = await client.read(blobId);

// Get the read URL
const url = client.readUrl(blobId);

// Check if it exists
const exists = await client.exists(blobId);
```

### `Skill` Interface

```typescript
interface Skill {
  info(): SkillInfo;                    // Metadata
  run(ctx: SkillContext): Promise<SkillResult>;  // Processing logic
}
```

Quick creation with `createSkill()`:

```typescript
const skill = createSkill(
  { name: "my-skill", title: "My Skill", description: "...", version: "0.1.0" },
  async (ctx) => {
    return {
      ok: true,
      message: "done",
      outputs: [
        { filename: "result.json", contentType: "application/json", data },
      ],
    };
  },
);
```

---

## 🖥️ CLI Usage

```bash
# Upload a file
npx walgent upload ./photo.png --epochs 5

# Read a blob
npx walgent read 0xblobId --out output.png

# Get the read URL
npx walgent url 0xblobId

# Check if a blob exists
npx walgent exists 0xblobId
```

Environment variable configuration:

```bash
# .env
WALRUS_NETWORK=testnet
WALRUS_EPOCHS=5
# WALRUS_PUBLISHER_URL=https://...     # Custom publisher
# WALRUS_AGGREGATOR_URL=https://...    # Custom aggregator
```

---

## 📁 Project Structure

```
walgent/
├── assets/               # Logo, icons, and other static assets
├── website/              # Landing page
│   ├── index.html
│   └── favicon.svg
├── src/
│   ├── index.ts          # Public export entry
│   ├── types.ts          # All TypeScript type definitions
│   ├── walrus.ts         # WalrusClient - HTTP client
│   ├── skill.ts          # Skill interface and factory function
│   ├── agent.ts          # WalrusAgent - orchestrator
│   ├── wallet.ts         # Wallet & private key management (Mainnet)
│   ├── utils.ts          # Utility functions
│   └── cli.ts            # CLI command-line tool
├── examples/
│   ├── image-agent.ts    # Example: Image generation agent
│   └── text-storage.ts   # Example: Text storage agent
├── tests/
│   ├── walrus.test.ts    # WalrusClient tests
│   ├── agent.test.ts     # WalrusAgent tests
│   └── wallet.test.ts    # WalletManager tests
├── docs/
│   └── MAINNET.md        # Mainnet deployment guide
├── scripts/
│   └── gen-assets.ts     # Asset generation script
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🧪 Testing

```bash
npm test
```

All tests use the Node.js built-in `node:test` runner with mocked fetch — no real network required.

---

## 🔧 Advanced Usage

### Mainnet Private Key Management

Walrus requires WAL tokens to pay for storage on Mainnet. Walgent provides three strategies:

1. **Self-hosted Publisher** (recommended for production): Private keys stay on your node; the agent never touches them
2. **Upload Relay**: Use a third-party relay service to pay WAL on your behalf
3. **On-chain Signing**: The agent holds the private key and pays directly

See [docs/MAINNET.md](docs/MAINNET.md) for detailed configuration.

```typescript
const agent = new WalrusAgent({
  walrus: { network: "mainnet", publisherUrl: "..." },
  wallet: { source: "env", envVar: "WALRUS_SUI_PRIVATE_KEY" },
  checkBalanceBeforeUpload: true,
});
```

### Custom Walrus Endpoints

```typescript
const agent = new WalrusAgent({
  walrus: {
    publisherUrl: "https://my-publisher.example.com",
    aggregatorUrl: "https://my-aggregator.example.com",
  },
});
```

### Pre-upload Interception

```typescript
const agent = new WalrusAgent({
  onBeforeUpload: (artifact) => {
    // Skip files larger than 10MB
    return artifact.data.length < 10 * 1024 * 1024;
  },
});
```

---

## 📖 About Walrus

[Walrus](https://walrus.site) is a decentralized storage network developed by Mysten Labs (the team behind the Sui blockchain). It:

- Uses erasure coding for efficient, low-cost large-scale storage
- Deeply integrated with the Sui blockchain
- Uploads via the Publisher API, reads via the Aggregator API
- Suitable for storing images, videos, documents, AI model outputs, and more

Official docs: https://docs.walrus.site

---

## 📄 License

MIT