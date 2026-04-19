# @emblemvault/agentwallet

The CLI for **EmblemVault Agent Wallet** -- giving AI agents their own crypto wallets across 7 blockchains. Designed for use in [OpenClaw](https://openclaw.ai), autonomous agent frameworks, and any system where AI agents need to hold, send, and manage crypto independently.

Each agent gets a deterministic wallet derived from a password. No seed phrases, no manual key management. The agent authenticates once and gets addresses on Solana, Ethereum, Base, BSC, Polygon, Hedera, and Bitcoin -- ready to trade, hold, and transact.

## Install

```bash
npm install -g @emblemvault/agentwallet
```

## Use with MCP clients (Claude Code, Cursor, Windsurf, …)

You do not need the CLI to call EmblemAI tools from an MCP-compatible client. Install the hosted EmblemAI MCP server directly:

```bash
claude mcp add --transport http EmblemAI https://emblemvault.ai/api/mcp
```

The first call opens the hosted OAuth flow in your browser. No API key to paste. API key and JWT bearer auth are also supported — see https://emblemvault.ai/docs/mcp for the full install matrix (Claude Desktop bridge, GitHub Copilot CLI, Gemini CLI).

The CLI below stays the right choice for agent-mode automation and profile-aware local development.

## Development

Use TypeScript's checker against the JavaScript source and JSDoc annotations:

```bash
npm run typecheck
```

## Quick Start

```bash
# Agent mode -- give your AI agent a wallet (auto-generates credentials on first run)
emblemai --agent -m "What are my wallet addresses?"

# Agent mode with an explicit named profile
emblemai --profile treasury --agent -m "Show my balances across all chains"

# Agent mode with a specific wallet identity
emblemai --agent -p "my-agent-password-here" -m "Show my balances across all chains"

# Interactive mode -- opens browser for human authentication
emblemai

# Manage profiles
emblemai profile list
emblemai profile create treasury
emblemai profile use treasury
```

## Profiles

EmblemAI now supports multiple named wallet profiles per installation. Each profile gets its own:

- encrypted password (`.env` + `.env.keys`)
- browser auth session (`session.json`)
- plugin secrets (`secrets.json`)
- custom plugin state (`plugins.json`)
- MPP state (`mpp-state.json`)
- x402 favorites (`x402-favorites.json`)
- chat history (`history/`)

Storage layout:

```text
~/.emblemai/
  active-profile
  profiles/
    default/
      metadata.json
      session.json
      .env
      .env.keys
      secrets.json
      plugins.json
      mpp-state.json
      x402-favorites.json
      history/
    treasury/
      ...
```

Use `--profile <name>` to select a profile for a single invocation, or `emblemai profile use <name>` to switch the default active profile for future runs.

Existing single-wallet installs are migrated automatically into `profiles/default`.

## Authentication

EmblemAI v3 supports two authentication methods:

### Browser Auth (Interactive Mode)

When you run `emblemai` without `-p`, the CLI:

1. Resolves the active profile from `--profile`, `~/.emblemai/active-profile`, or `default`
2. Checks for a saved session in `~/.emblemai/profiles/<profile>/session.json`
3. If no valid session, opens your browser to authenticate via the EmblemVault auth modal
4. Captures the JWT session and saves it locally inside that profile
5. On subsequent runs, restores the saved session automatically

If the browser fails to open, the URL is printed for manual copy-paste. If authentication times out (5 minutes), falls back to password prompt.

### Password Auth (Agent Mode)

Agent mode always uses password authentication:

- Auto-generates a secure password on first run if none provided
- Password is stored encrypted via dotenvx in `~/.emblemai/profiles/<profile>/.env`
- Use `-p` flag to provide a specific password

**Login and signup are the same action.** The first use of a password creates a vault; subsequent uses return the same vault. Different passwords produce different wallets.

- Password must be 16+ characters
- No recovery if lost (treat it like a private key)
- If the CLI auto-generates a password for you, back it up soon after wallet creation

**Important:** password auth is one of the main ways agents and operators get repeatable wallet access without browser auth. But the password is effectively wallet-critical material. If you lose local credentials and do not have a backup, you may lose access to that wallet.

## Operating Modes

### Interactive Mode (Default)

Readline-based interactive mode with streaming AI responses, glow markdown rendering, and slash commands.

```bash
emblemai              # Browser auth (recommended)
emblemai --profile treasury
emblemai -p "your-password"  # Password auth
```

### Agent Mode

Agent mode is the primary integration point for AI agents, automation scripts, and agent frameworks like OpenClaw. It sends a single message, prints the response to stdout, and exits -- designed for programmatic use where another system is orchestrating the agent.

If more than one profile exists in `$HOME/.emblemai`, every agent-mode invocation must include `--profile <name>`. Agent mode never guesses which wallet identity to use.

**Zero-config setup**: On first run without a password, agent mode auto-generates a secure password and stores it encrypted. The agent gets a wallet immediately with no human intervention.

```bash
# First run -- auto-generates password, creates wallet, answers query
emblemai --agent -m "What are my wallet addresses?"

# First run in a non-default profile
emblemai --profile treasury --agent -m "Show my balances"

# Explicit password -- use when you need a specific wallet identity
emblemai --agent -p "your-password" -m "Show my balances"

# Pipe output to other tools
emblemai -a -m "What is my SOL balance?" | jq .

# Use in scripts
ADDRESSES=$(emblemai -a -m "List my addresses as JSON")
```

Agent mode always uses password auth (never browser auth), retains conversation history between calls, and supports the full EmblemAI toolset including trading, transfers, portfolio queries, and cross-chain operations.

#### Multiple agents using the same CLI instance
Session data is stored in `$HOME/.emblemai/` and is shared across all invocations of the CLI.
If you need to run multiple agents with different wallets on the same machine, you can use a different home directory for each agent instance:

```bash
HOME=/home/user/agent1 emblemai --agent -m "What are my wallet addresses?"
HOME=/home/user/agent2 emblemai --agent -m "What are my wallet addresses?"
```

#### Integrating with Agent Frameworks

Any system that can shell out to a CLI can give its agents a wallet:

```bash
# OpenClaw, CrewAI, AutoGPT, or any agent framework
emblemai --agent -m "Send 0.1 SOL to <address>"
emblemai --agent -m "Swap 100 USDC to ETH on Base"
emblemai --agent -m "What tokens do I hold across all chains?"
```

Each password produces a unique, deterministic wallet. To give multiple agents separate wallets, use different passwords or different profiles:

```bash
emblemai --agent -p "agent-alice-wallet-001" -m "My addresses?"
emblemai --agent -p "agent-bob-wallet-002" -m "My addresses?"
emblemai --profile treasury --agent -m "My addresses?"
emblemai --profile operations --agent -m "My addresses?"
```

If multiple profiles exist, all agent-mode CLI invocations require `--profile <name>` so the CLI never guesses which wallet identity to use.

### PAYG Billing

Use `--payg` to configure pay-as-you-go billing. This is a one-time setup -- the setting persists on the server, so you only need to run it once (or when you want to change the token or turn it off). Do not pass `--payg` on every request.

PAYG has two server-side modes:

- `pay_per_request` — every paid request is settled immediately using the selected payment token.
- `debt_accumulation` — requests can accrue debt until the configured debt ceiling is reached; once the ceiling is hit, the server may block new requests until debt is reduced.

The payment token is the asset used when PAYG settles charges. For example, if the token is `SOL`, paid requests settle in `SOL`; if the token is `ETH`, they settle in `ETH` (subject to what the server supports).

```bash
# Enable PAYG with SOL as payment token (run once)
emblemai --payg on SOL

# Enable PAYG, keep the current token
emblemai --payg on

# Disable PAYG
emblemai --payg off
```

Can be combined with `--agent` if needed:

```bash
emblemai --agent --payg on SOL -m "Show my balances"
```

### Reset Conversation

```bash
emblemai --reset
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `-p`, `--password <pw>` | EmblemVault password (min 16 chars) -- skips browser auth |
| `--profile <name>` | Select a named wallet profile for this invocation. Required in agent mode when more than one profile exists. |
| `-m`, `--message <msg>` | Message to send (agent mode) |
| `-a`, `--agent` | Agent mode (single message, exit) |
| `--payg on [TOKEN]` | One-time PAYG setup -- enable billing, optionally set payment token (SOL, ETH, etc.) |
| `--payg off` | Disable PAYG billing |
| `--restore-auth <path>` | Restore credentials from a backup file and exit |
| `--debug` | Enable debug output |
| `--stream` | Toggle streaming (default: on) |
| `--log` | Enable stream logging |
| `--log-file <path>` | Override log file path |
| `--reset` | Clear conversation history |
| `--hustle-url <url>` | Override Hustle API endpoint |
| `--auth-url <url>` | Override auth endpoint |
| `--api-url <url>` | Override API endpoint |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EMBLEM_PASSWORD` | Password (alternative to `-p`) |
| `HUSTLE_API_URL` | Hustle API endpoint override |
| `EMBLEM_AUTH_URL` | Auth endpoint override |
| `EMBLEM_API_URL` | API endpoint override |
| `ELIZA_URL` | ElizaOS URL for inverse discovery |

## Interactive Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/profile` | List profiles |
| `/profile create\|use\|inspect\|delete` | Manage wallet profiles |
| `/plugins` | List all plugins with status |
| `/plugin <name> on\|off` | Toggle a plugin |
| `/tools` | List available tools |
| `/tools add\|remove <id>` | Manage tool selection |
| `/tools clear` | Enable auto-tools mode |
| `/auth` | Authentication menu (session info, addresses, backup, logout) |
| `/wallet` | Show wallet addresses |
| `/portfolio` | Show portfolio |
| `/settings` | Show current settings |
| `/model <id>` | Set AI model (or `clear` to reset to the CLI default) |
| `/models` | Show current model and curated defaults |
| `/models search <query>` | Fuzzy-search OpenRouter models |
| `/stream on\|off` | Toggle streaming |
| `/debug on\|off` | Toggle debug mode |
| `/history on\|off` | Toggle history retention |
| `/payment` | PAYG status, token usage, and mode guide |
| `/payment enable\|disable` | Turn PAYG charging on or off |
| `/payment token <T>` | Set the token used to settle PAYG charges |
| `/payment mode <M>` | Set mode: `pay_per_request` or `debt_accumulation` |
| `/secrets` | Manage encrypted plugin secrets |
| `/safe` | Encrypted safe — store secrets, keys, passwords |
| `/safe set\|get\|list\|delete` | Manage individual secrets |
| `/x402` | x402 plugin status and quick actions |
| `/glow on\|off` | Toggle glow markdown rendering |
| `/log on\|off` | Toggle stream logging |
| `/reset` | Clear conversation |
| `/exit` | Exit |

## Auth Backup and Restore

The `/auth` menu includes a **Backup Agent Auth** option that exports your credentials to a single JSON file. If you are using password auth, especially an auto-generated password, this backup flow is the main recovery path you should know about.

```bash
emblemai --restore-auth ~/emblemai-auth-backup.json
```

This restores the credential files into the resolved active profile. If you pass `--profile <name>`, restore writes into that profile and creates it first when needed.

## Encrypted Safe

Store private keys, passwords, card numbers, API keys, and any secrets. Each entry is individually encrypted with AES-256-GCM using a key derived from your wallet password (scrypt). The server never sees plaintext.

### Store and Retrieve Secrets

```bash
# Store a secret (value inline or prompted)
emblemai safe set "eth-private-key" "0x4c0883a..."
emblemai safe set "bank-card"                      # prompts for value

# Retrieve a secret (raw output, pipeable)
emblemai safe get "eth-private-key"

# List stored secret names
emblemai safe list

# Delete a secret
emblemai safe delete "eth-private-key"
```

### Cloud Sync

Push your entire safe (credentials + secrets) to the cloud for cross-machine access:

```bash
emblemai safe push                              # encrypt + upload
emblemai safe pull -p "your-password"           # download + decrypt on new machine
emblemai safe push --profile treasury           # specific profile
```

### File Export / Import

For offline backup or transferring without the cloud:

```bash
emblemai safe export ~/emblemai-safe.enc
emblemai safe import ~/emblemai-safe.enc -p "your-password"
```

### Interactive Mode

In the interactive CLI, use `/safe` for a guided menu, or `/safe set`, `/safe get`, `/safe list`, `/safe delete` directly.

### Agent Integration

```bash
# New machine setup: pull safe, then use secrets
emblemai safe pull -p "$AGENT_PASSWORD"
ETH_KEY=$(emblemai safe get "eth-private-key")

# Store a secret from an agent
emblemai safe set "api-token" "$TOKEN"

# Backup after changes
emblemai safe push
```

## Local Development

```bash
git clone git@github.com:EmblemCompany/EmblemAi-cli.git
cd EmblemAi-cli
npm install

# Run directly (no build step)
node emblemai.js --help

# Profile management
node emblemai.js profile list
node emblemai.js profile create treasury
node emblemai.js profile use treasury

# Run tests
npm test
npm run test:coverage

# Interactive mode
node emblemai.js

# Agent mode
node emblemai.js --profile treasury --agent -m "Show balances"
```

Recommended operator habit:
1. create or authenticate the wallet
2. confirm the wallet addresses look right
3. run `/auth` → **Backup Agent Auth**
4. store the backup somewhere secure and offline-friendly

## Plugins

| Plugin | Status | Description |
|--------|--------|-------------|
| MPP | Loaded by default | Call Machine Payments Protocol endpoints with the official `402` challenge / `Payment-Receipt` flow via `mppx` |
| x402 | Loaded by default | Pay-per-call access to 11,000+ paid APIs and AI services via the [x402 protocol](https://x402.org) |
| ElizaOS | Loaded by default | ElizaOS agent framework with MASQ and inverse discovery |

Additional plugins exist but are currently disabled. See [docs/PLUGINS.md](docs/PLUGINS.md) for details.

### MPP Client Plugin

The MPP plugin lets your agent call payment-gated HTTP endpoints that follow the official Machine Payments Protocol flow described in Stripe's MPP docs: `402` challenge → `Authorization: Payment` → `Payment-Receipt`.

This implementation uses the reference `mppx/client` SDK with Emblem's EVM signer from `@emblemvault/auth-sdk`.

**Current scope**

- Tempo-backed crypto MPP endpoints
- Public MPP service discovery via `https://mpp.dev/api/services`
- Profile-scoped Tempo resume hints in `~/.emblemai/profiles/<profile>/mpp-state.json`
- Receipt extraction from the `Payment-Receipt` header

**Current limitations**

- Stripe-backed MPP flows are intentionally removed from this branch for now
- No dedicated streaming/SSE helper yet

```bash
# Call a generic MPP endpoint
emblemai --agent -m 'Use mpp_call to call https://parallelmpp.dev/api/search with body {"query":"AI agent payments 2026","mode":"fast"}'

# Discover public MPP services
emblemai --agent -m 'Use mpp_services to list active AI services from the official MPP directory'

# Inspect plugin status interactively
/mpp

# Inspect persisted Tempo state interactively
/mpp state
```

Official references:

- Stripe docs: https://docs.stripe.com/payments/machine/mpp
- MPP client quickstart: https://mpp.dev/quickstart/client
- Public service directory: https://mpp.dev/api/services

Deferred Stripe note: the removed Stripe path used callback-based shared payment tokens (SPTs), not local secret-key handling. Re-enabling it would require a user-provided token endpoint that accepts `amount`, `challenge`, `currency`, `expiresAt`, `metadata`, `networkId`, and `paymentMethod`, then returns an SPT as a string body or JSON `{ "spt": "..." }` / `{ "token": "..." }`. Testing also requires a Stripe-capable MPP service plus saved defaults for the token endpoint and payment method.

### x402 Payment Plugin

The x402 plugin lets your agent discover and pay for services across the x402 ecosystem. It handles 402 payment negotiation, cryptographic signing, and on-chain settlement automatically.

**Supported networks**: Base (EVM/USDC via EIP-3009 gasless permits), Solana (USDC via SPL transfers)

```bash
# Search for paid services
emblemai --agent -m "Use x402_search to find trending token services"

# Call a paid API with automatic payment
emblemai --agent -m "Use x402_call to call https://emblemvault.ai/api/tools/execute/unified/currentUnixTimestamp"

# Prefer a specific payment network
emblemai --agent -m "Use x402_call to call https://emblemvault.ai/api/tools/execute/unified/birdeyeTrendingTokens with preferredNetwork solana"
```

The plugin provides 5 tools:

| Tool | Description |
|------|-------------|
| `x402_search` | Search paid APIs and services via [XGate](https://xgate.run) |
| `x402_agents` | Search on-chain AI agents by capability or protocol |
| `x402_call` | Call any x402-gated URL with automatic payment |
| `x402_stats` | Get x402 ecosystem statistics |
| `x402_favorites` | Save and manage favorite services |

See [docs/PLUGINS.md](docs/PLUGINS.md) for full parameter reference.

## Optional: Glow (Markdown Rendering)

Install [glow](https://github.com/charmbracelet/glow) for rich markdown rendering in AI responses:

```bash
brew install glow    # macOS
sudo snap install glow  # Linux
```

Toggle with `/glow on|off`.

## Supported Chains

Solana, Ethereum, Base, BSC, Polygon, Hedera, Bitcoin

## Documentation

- [Setup Guide](docs/SETUP.md) -- installation, auth, running modes
- [Commands](docs/COMMANDS.md) -- full command reference
- [Plugins](docs/PLUGINS.md) -- plugin system and tool reference

## Links

- [EmblemVault](https://emblemvault.dev)
- [EmblemAI](https://emblemvault.ai)
- [GitHub](https://github.com/EmblemCompany/EmblemAi-AgentWallet)
