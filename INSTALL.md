# Codebase Memory — Installation Guide

## Prerequisites

- **VS Code** 1.85.0 or later
- **codebase-memory-mcp binary** 0.8.0+ installed on your system PATH

### Installing the binary

The binary is required — the extension is a frontend for it.

**Linux / macOS (brew):**
```bash
brew install deusdata/tap/codebase-memory-mcp
```

**Linux / macOS (curl):**
```bash
curl -fsSL https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/install.sh | bash
```

**Windows (winget):**
```powershell
winget install DeusData.codebase-memory-mcp
```

**Windows (manual):**
1. Download the latest `.exe` from [releases](https://github.com/DeusData/codebase-memory-mcp/releases)
2. Place it in a directory on your `%PATH%` (e.g. `%LOCALAPPDATA%\Programs\codebase-memory-mcp\`)
3. Verify: open a new PowerShell terminal and run `codebase-memory-mcp --version`

---

## Install the extension

### Option A — From VSIX (recommended for pre-release)

Download the latest `.vsix` from [releases](https://github.com/DeusData/codebase-memory-mcp-vscode-ext/releases), then:

```bash
code --install-extension deusdata.codebase-memory-vscode-*.vsix
```

### Option B — From VS Code Marketplace *(coming soon)*

Open the Extensions view (`Ctrl+Shift+X`), search for **"Codebase Memory"**, and click Install.

### Option C — Build from source

Requires Node.js 18+.

```bash
git clone https://github.com/DeusData/codebase-memory-mcp-vscode-ext
cd codebase-memory-mcp-vscode-ext

# Install dependencies
npm install --ignore-scripts

# Build the extension bundle
node esbuild.config.mjs

# Package as VSIX
npx vsce package

# Install
code --install-extension deusdata.codebase-memory-vscode-*.vsix
```

---

## Configuration

Open VS Code Settings (`Ctrl+,`) and search for `codebase-memory`.

| Setting | Default | Description |
|---|---|---|
| `codebase-memory.binaryPath` | `""` | Full path to the `codebase-memory-mcp` binary. Leave empty to search PATH. |
| `codebase-memory.graphPort` | `9749` | Port for the 3D graph visualization HTTP server. |
| `codebase-memory.autoStart` | `true` | Start the MCP server automatically when VS Code starts. |
| `codebase-memory.customQueries` | `[]` | Saved Cypher queries with optional keybindings. Edited via the Query Editor webview. |

---

## Verify installation

1. Reload VS Code (`Ctrl+Shift+P` → `Developer: Reload Window`)
2. Open the **Codebase Memory** activity bar icon (database icon in the left sidebar)
3. Click **Start Server** in the status bar, or run `Codebase Memory: Start Server` from the Command Palette
4. The status bar should show a green **Codebase Memory** badge

If the binary is not found, the extension shows an error dialog with options to view install instructions or open settings.

---

## Troubleshooting

| Problem | Check |
|---|---|
| Extension not loading | Run `Developer: Show Running Extensions` — look for `DeusData.codebase-memory-vscode` |
| "Binary not found" error | Verify `codebase-memory-mcp --version` works in a terminal, or set `codebase-memory.binaryPath` in settings |
| Server fails to start | Open the **Codebase Memory** output channel (`Ctrl+Shift+U` and select "Codebase Memory" from the dropdown) for stderr logs |
| 3D graph shows "Server unreachable" | Ensure the codebase-memory-mcp binary was started with `--ui` flag (the extension runs it with default args) |
| Commands are missing | The extension activates on first use. Run any command from the Command Palette to trigger activation |
