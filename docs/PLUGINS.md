# EmblemAI Plugin Reference

EmblemAI uses a plugin system to extend AI capabilities with client-side tools. Plugins are loaded at startup and register tools that the AI can call during conversations.

---

## Active Plugins

### MPP -- Machine Payments Protocol

**Status**: Loaded by default
**Description**: Calls MPP payment-gated HTTP endpoints using the official `402` challenge → `Authorization: Payment` → `Payment-Receipt` flow. This implementation uses the `mppx/client` SDK plus Emblem's EVM signer from `@emblemvault/auth-sdk`.

This section is grounded in the official Stripe MPP docs:

- https://docs.stripe.com/payments/machine/mpp
- https://mpp.dev/quickstart/client

#### Current Scope

- Tempo-backed crypto MPP requests
- Automatic credential creation with the Emblem EVM signer
- Public service discovery through `https://mpp.dev/api/services`
- Profile-scoped Tempo session resume hints stored in `~/.emblemai/profiles/<profile>/mpp-state.json`
- Support for both Tempo `charge` and `session` intents through `mppx`
- Receipt extraction from the `Payment-Receipt` header

#### Current Limitations

- Stripe-backed MPP flows are intentionally removed in this branch
- Streaming/SSE-specific helpers are not included in this first slice

#### Tools

##### mpp_call

Call an MPP endpoint with automatic payment handling.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Full MPP endpoint URL |
| `method` | string | No | HTTP method. Defaults to `GET` when no body is supplied, otherwise `POST` |
| `body` | string | No | Optional raw string or JSON string request body |
| `headers` | string | No | Optional JSON string of extra request headers |
| `paymentMethod` | string | No | Preferred MPP method. Only `tempo` is currently supported |
| `deposit` | string | No | Optional Tempo session deposit amount in human-readable units |
| `maxDeposit` | string | No | Optional cap for auto-managed Tempo session deposits |
| `paymentMode` | string | No | Tempo credential transport mode: `push` or `pull` |
| `action` | string | No | Manual Tempo session action: `open`, `topUp`, `voucher`, `close` |
| `channelId` | string | No | Session channel ID for manual session flows |
| `cumulativeAmountRaw` | string | No | Raw cumulative amount for manual voucher/close flows. Prefer when reusing values from receipts or persisted state |
| `cumulativeAmount` | string | No | Human-unit cumulative amount for manual voucher/close flows |
| `transaction` | string | No | Serialized transaction for manual open/topUp flows |
| `authorizedSigner` | string | No | Authorized signer address for session vouchers |
| `additionalDepositRaw` | string | No | Raw additional deposit amount for manual top-up flows |
| `additionalDeposit` | string | No | Additional deposit amount for manual top-up flows |
##### mpp_services

List public MPP services from the official service directory.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Free-text search across service id, name, description, categories, and tags |
| `category` | string | Category filter such as `ai` or `blockchain` |
| `tag` | string | Tag filter such as `email` or `prices` |
| `method` | string | Payment method filter such as `tempo` |
| `status` | string | Status filter such as `active` |
| `limit` | number | Maximum results (default 10, max 50) |

##### mpp_service_info

Inspect one public MPP service and its endpoint/payment metadata.

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Exact service id when known |
| `query` | string | Fallback query when the id is not known |

##### mpp_state

Show persisted per-profile MPP state.

Returns:

- resumable Tempo channel hints

#### Notes

- The plugin returns parsed response data plus any available `Payment-Receipt`.
- The plugin currently assumes an authenticated Emblem session and reuses the auth-sdk EVM account for MPP credential signing.
- Tempo persistence stores only the minimum safe resume tuple (`channelId`, recipient, currency, chain metadata, cumulative amount).
- Persisted/state cumulative values are raw on-chain units and are surfaced as `cumulativeAmountRaw` to avoid unit confusion.
- Deferred Stripe note: the removed Stripe path used a callback endpoint rather than local Stripe secret-key logic inside the CLI. Re-enabling it would require a token-mint endpoint that accepts `amount`, `challenge`, `currency`, `expiresAt`, `metadata`, `networkId`, and `paymentMethod`, then returns an SPT via a raw string response or JSON with `spt` / `token`.

---

### x402 -- Pay-Per-Call API Access

**Status**: Loaded by default
**Description**: Enables agents to discover and pay for 11,000+ x402-gated services across the ecosystem. Handles HTTP 402 payment negotiation, cryptographic signing (EVM + Solana), and on-chain settlement automatically.

Supports both x402 protocol v1 (X-PAYMENT header, used by Coinbase x402 and most early servers) and v2 (PAYMENT-SIGNATURE header, used by strict servers like PULL.md).

#### Supported Payment Networks

| Network | Token | Transfer Method |
|---------|-------|-----------------|
| Base (EVM) | USDC | EIP-3009 gasless permit (no gas fees) |
| Solana | USDC | SPL token transfer |

#### Tools

##### x402_search

Search paid APIs and services via [XGate](https://xgate.run).

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Free text search (e.g. "trending tokens", "swap", "AI agent") |
| `network` | string | Network filter: base, ethereum, polygon, solana (comma-separated) |
| `asset` | string | Asset filter (comma-separated) |
| `limit` | number | Max results (1-50, default 10) |

##### x402_agents

Search AI agents registered on-chain via XGate.

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Free text search |
| `protocols` | string | Protocol filter: A2A, MCP (comma-separated) |
| `skills` | string | Required skill names (comma-separated) |
| `limit` | number | Max results (1-50, default 10) |

##### x402_call

Call any x402 payment-gated resource URL with automatic payment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Full URL of the x402 resource |
| `body` | string | No | JSON string of request body / tool parameters |
| `method` | string | No | HTTP method (default: POST) |
| `preferredNetwork` | string | No | Preferred payment network: "solana" for SOL USDC, "base" or "evm" for Base USDC |
| `passAuth` | string | No | Set "true" to pass wallet auth (only works for local Hustle server) |
| `walletAddress` | string | No | Buyer EVM wallet address for wallet-binding on strict v2 servers |
| `clientMode` | string | No | Set "agent" for strict headless mode (recommended for PULL.md) |

##### x402_stats

Get x402 ecosystem statistics from XGate (total agents, services, chains).

No parameters required.

##### x402_favorites

Manage favorite x402 services.

| Parameter | Type | Description |
|-----------|------|-------------|
| `action` | string | Action: list, add, remove, note (default: list) |
| `url` | string | Service URL (required for add/remove/note) |
| `note` | string | Note text (for add or note actions) |
| `name` | string | Display name (for add action) |
| `tags` | string | Comma-separated tags (for add action) |

#### Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `X402_HUSTLE_URL` | Override EmblemAI server URL for auth passthrough | `https://emblemvault.ai` |

#### Signing Architecture

The plugin uses `@emblemvault/auth-sdk` for all cryptographic signing -- no private keys are ever held locally. Signing requests are routed through the EmblemVault API to Lit Protocol MPC nodes:

- **EVM**: `auth-sdk.toViemAccount()` provides a viem-compatible account with `signTypedData` for EIP-3009 gasless permits
- **Solana**: `auth-sdk.toSolanaWeb3Signer()` is bridged to `@solana/kit`'s `TransactionSigner` interface for SPL token transfers

---

### ElizaOS -- AI Agent Framework

**Package**: `@agenthustle/plugin-masq`
**Status**: Loaded by default
**Description**: Connects Hustle to the ElizaOS agent framework. Provides MASQ mode (HTTP server on port 3001) and inverse discovery to discover and register ElizaOS actions as client tools.

#### Configuration

The plugin is auto-configured at startup with:

- **MASQ**: Enabled on port 3001 -- exposes Hustle as an ElizaOS-compatible HTTP agent
- **Inverse discovery**: Enabled -- discovers actions from a running ElizaOS instance and registers them as client tools
- **Hustle client**: Wired automatically for inverse control (ElizaOS actions route through `hustleClient.chat()`)

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ELIZA_URL` | ElizaOS agent URL for inverse discovery | `http://localhost:3000` |
| `ELIZA_API_URL` | ElizaOS API URL (via `--eliza-url` flag) | -- |

---

## Available Plugins (Not Loaded)

The following plugins exist as packages but are currently disabled in the plugin loader. They can be re-enabled in `src/plugins/loader.js` by uncommenting their specs.

| Plugin | Package | Description |
|--------|---------|-------------|
| A2A | `@agenthustle/plugin-a2a` | Google Agent-to-Agent protocol v0.3.0 (discovery, messaging, tasks) |
| ACP | `@agenthustle/plugin-acp` | Virtuals Agent Commerce Protocol (marketplace, jobs, autonomous mode) |
| Bridge | `@agenthustle/plugin-bridge` | Cross-protocol message router (A2A, ACP, ElizaOS) |

---

## Plugin Management

### Commands

```
/plugins                    # List all plugins and their status
/plugin <name> on           # Enable a plugin
/plugin <name> off          # Disable a plugin
```

### Tool Selection

```
/tools                      # List all available tools
/tools add <id>             # Add a tool to the active set
/tools remove <id>          # Remove a tool from the active set
/tools clear                # Clear selection (enable auto-tools mode)
```

When no tools are explicitly selected, the AI uses **auto-tools mode**, dynamically selecting appropriate tools based on conversation context.

---

## Plugin Architecture

### Plugin Interface

Plugins follow the `HustlePlugin` interface:

```js
{
  name: 'plugin-name',
  version: '1.0.0',
  tools: [
    {
      name: 'tool_name',
      description: 'What the tool does',
      parameters: { type: 'object', properties: { ... } },
    },
  ],
  executors: {
    tool_name: async (args) => { /* implementation */ },
  },
}
```

### Loading

Plugins are loaded in `src/plugins/loader.js` via `PluginManager.loadAll()`. Each plugin spec declares:

- `mod` -- npm package name
- `factory` -- exported factory function name
- `configKey` -- key in the config object for per-plugin settings

Missing packages are silently skipped.

### Secrets

Plugins can declare secrets (e.g., API keys) that are encrypted with the user's vault key and stored in `~/.emblemai/profiles/<profile>/secrets.json`. Secrets are lazily decrypted on first tool use. Use `/secrets` to manage them interactively.

### Custom Plugins

User-created plugins are stored in `~/.emblemai/profiles/<profile>/plugins.json` and loaded at startup. Custom plugins use serialized executor code that is compiled at load time.
