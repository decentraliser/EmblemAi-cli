# EmblemAI Command Reference

## Slash Commands

All commands are prefixed with `/`. Type them in the input bar and press Enter.

### General

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/profile` | List profiles and show the active wallet identity |
| `/profile create\|use\|inspect\|delete` | Manage wallet profiles |
| `/settings` | Show current configuration (vault ID, model, streaming, debug, tools) |
| `/exit` | Exit the CLI (also: `/quit`) |

### Chat and History

| Command | Description |
|---------|-------------|
| `/reset` | Clear conversation history and start fresh |
| `/clear` | Alias for `/reset` |
| `/history on` | Enable history retention between messages |
| `/history off` | Disable history retention (stateless mode) |
| `/history` | Show history status and recent messages |

### Streaming and Debug

| Command | Description |
|---------|-------------|
| `/stream on` | Enable streaming mode (tokens appear as generated) |
| `/stream off` | Disable streaming mode (wait for full response) |
| `/stream` | Show current streaming status |
| `/debug on` | Enable debug mode (shows tool args, intent context) |
| `/debug off` | Disable debug mode |
| `/debug` | Show current debug status |

### Model Selection

| Command | Description |
|---------|-------------|
| `/model <id>` | Set the active model by ID |
| `/model clear` | Reset to the CLI's default model |
| `/model` | Show currently selected model |
| `/models` | Show the active model plus curated default choices |
| `/models use <number\|id>` | Pick one of the curated default models |
| `/models search <query>` | Fuzzy-search OpenRouter models and pick one via `/model <number\|id>` |

### Tool Management

| Command | Description |
|---------|-------------|
| `/tools` | List all tools with selection status |
| `/tools add <id>` | Add a tool to the active set |
| `/tools remove <id>` | Remove a tool from the active set |
| `/tools clear` | Clear tool selection (enable auto-tools mode) |

When no tools are selected, the AI operates in **auto-tools mode**, dynamically choosing appropriate tools based on conversation context.

### Authentication

| Command | Description |
|---------|-------------|
| `/auth` | Open authentication menu |
| `/wallet` | Show wallet addresses (EVM, Solana, BTC, Hedera) |
| `/portfolio` | Show portfolio (routes as a chat query) |

The `/auth` menu provides:

| Option | Description |
|--------|-------------|
| 1. Get API Key | Fetch your vault API key |
| 2. Get Vault Info | Show vault ID, addresses, creation date |
| 3. Session Info | Show current session details (identifier, expiry, auth type) |
| 4. Refresh Session | Refresh the auth session token |
| 5. EVM Address | Show your Ethereum/EVM address |
| 6. Solana Address | Show your Solana address |
| 7. BTC Addresses | Show your Bitcoin addresses (P2PKH, P2WPKH, P2TR) |
| 8. Backup Agent Auth | Export credentials to a backup file |
| 9. Logout | Clear session and exit (requires re-authentication on next run) |

### Payment (PAYG Billing)

| Command | Description |
|---------|-------------|
| `/payment` | Show PAYG billing status, debt, token usage, and a mode guide |
| `/payment enable` | Enable pay-as-you-go billing |
| `/payment disable` | Disable pay-as-you-go billing |
| `/payment token <TOKEN>` | Set the token used to settle PAYG charges (SOL, ETH, HUSTLE, etc.) |
| `/payment mode <MODE>` | Set mode: `pay_per_request` (charge each request immediately) or `debt_accumulation` (let debt build until the ceiling is reached) |

`/payment` now explains both modes inline:

- `pay_per_request` settles each paid request immediately using the selected token.
- `debt_accumulation` lets requests accrue debt until the server-side debt ceiling is reached, after which the server may block new paid requests.

The selected payment token is the asset used when PAYG actually settles charges.

### Plugin Management

| Command | Description |
|---------|-------------|
| `/plugins` | List all plugins with enabled/disabled status |
| `/plugin <name> on` | Enable a plugin by name |
| `/plugin <name> off` | Disable a plugin by name |

### x402 Payments

| Command | Description |
|---------|-------------|
| `/x402` | Show x402 plugin status and quick actions |

The x402 plugin provides AI tools (`x402_search`, `x402_agents`, `x402_call`, `x402_stats`, `x402_favorites`) that the AI invokes automatically during conversations. Use natural language to search for and call paid services:

```
"Search for trending token services on x402"
"Call https://example.com/api/data using solana"
"Show x402 ecosystem stats"
```

### MPP Payments

| Command | Description |
|---------|-------------|
| `/mpp` | Show MPP plugin status, scope, and quick usage |
| `/mpp call <url> [json-body]` | Call an MPP endpoint with automatic payment handling |
| `/mpp services [query]` | Browse public MPP services from the official directory |
| `/mpp service <id\|query>` | Inspect one MPP service and its paid endpoints |
| `/mpp state` | Show persisted Tempo resume state |
| `/mpp state clear` | Clear persisted Tempo channel hints for the active profile |

The current MPP client flow follows Stripe's documented `402` challenge → `Authorization: Payment` → `Payment-Receipt` pattern and uses the official `mppx` SDK.

Current scope in this branch:

- Tempo-backed crypto MPP endpoints
- Public service discovery through `https://mpp.dev/api/services`
- Persisted Tempo session/channel resume hints per profile
- Receipt extraction

Current limitations:

- Stripe-backed MPP flows are intentionally removed in this branch
- No dedicated SSE/streaming helper yet

When reusing Tempo values from `/mpp state` or receipts, prefer the raw-unit fields (`cumulativeAmountRaw`, `additionalDepositRaw`) over the human-unit fields.

Deferred Stripe implementation note:

- The removed Stripe path was callback-based and required a user-supplied SPT mint endpoint
- The endpoint contract accepted `amount`, `challenge`, `currency`, `expiresAt`, `metadata`, `networkId`, and `paymentMethod`
- The endpoint response could be a raw token string or JSON with `spt` / `token`
- Testing required saved endpoint/payment-method defaults plus a Stripe-capable MPP service

### Encrypted Safe

Store private keys, passwords, card numbers, API keys, and any secrets. Each entry is individually encrypted with AES-256-GCM. The server never sees plaintext.

| Command | Description |
|---------|-------------|
| `/safe` | Interactive safe menu |
| `/safe set <name> [value]` | Store a secret (prompts for value if omitted) |
| `/safe get <name>` | Retrieve a secret |
| `/safe list` | List stored secret names |
| `/safe delete <name>` | Delete a secret |
| `/safe push` | Encrypt and push entire safe to cloud |
| `/safe pull` | Pull safe from cloud and decrypt |
| `/safe export [path]` | Export encrypted safe file (default: `~/emblemai-safe.enc`) |
| `/safe import <path>` | Import a safe file into the current profile |

**CLI subcommands** (no interactive session required):

```bash
# Secret management
emblemai safe set "eth-key" "0x4c08..."   # Store a secret
emblemai safe set "bank-card"             # Prompts for value
emblemai safe get "eth-key"               # Retrieve (raw output, pipeable)
emblemai safe list                        # List names
emblemai safe delete "eth-key"            # Remove

# Cloud sync
emblemai safe push                        # Push safe to cloud
emblemai safe pull -p "password"          # Pull safe from cloud

# File backup
emblemai safe export ~/backup.enc         # Export encrypted file
emblemai safe import ~/backup.enc         # Import from file
```

Add `--profile <name>` to target a specific profile, and `-p "password"` to provide the password non-interactively.

### Secrets

| Command | Description |
|---------|-------------|
| `/secrets` | Manage encrypted plugin secrets (interactive menu) |

Secrets are encrypted with your vault key and stored in `~/.emblemai/profiles/<profile>/secrets.json`. Plugins are hot-reloaded after setting a secret (no restart needed).

### Markdown Rendering

| Command | Description |
|---------|-------------|
| `/glow on` | Enable markdown rendering via glow |
| `/glow off` | Disable markdown rendering |
| `/glow` | Show glow status and version |

Requires [glow](https://github.com/charmbracelet/glow) to be installed.

### Logging

| Command | Description |
|---------|-------------|
| `/log on` | Enable stream logging to file |
| `/log off` | Disable stream logging |
| `/log` | Show logging status and file path |

Log file defaults to `~/.emblemai-stream.log`. Override with `--log-file <path>`.

## Keyboard Shortcuts

### Simple Mode (Default)

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Up` | Recall previous input |
| `Ctrl+C` | Exit |
| `Ctrl+D` | Exit (EOF) |

### TUI Mode

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle focus between panels |
| `Enter` | Send message |
| `Ctrl+C` | Exit |
| `Up/Down` | Scroll panel content |
| Mouse scroll | Scroll in focused panel |

## Command Examples

### Session management

```
/settings
/auth
/wallet
/payment
/reset
```

### Tool and model management

```
/tools
/model gpt-4
/stream off
/debug on
```

### Plugin management

```
/plugins
/plugin hustle-elizaos on
/plugin hustle-elizaos off
```
