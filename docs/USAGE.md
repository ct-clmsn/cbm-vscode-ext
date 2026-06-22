# Codebase Memory — User Guide

## Overview

Codebase Memory builds a persistent **knowledge graph** of your codebase — functions, classes, modules, and their relationships — and lets you search, trace, and visualize it from within VS Code.

The extension runs a local MCP server (the `codebase-memory-mcp` binary) that parses your repositories using Tree-sitter and stores the graph in an embedded database.

---

## Quick start

1. Open a project folder in VS Code
2. Click the **Codebase Memory** icon in the activity bar (left sidebar)
3. Click **Index a repository...** in the tree view, or run `Codebase Memory: Index Repository` from the Command Palette (`Ctrl+Shift+P`)
4. Pick a workspace folder or browse to a directory
5. Wait for indexing to complete (shown in a progress notification)
6. Once indexed, the project appears in the sidebar with node/edge counts

---

## Commands

All commands are accessible via the Command Palette (`Ctrl+Shift+P`). Type `Codebase Memory:` to filter.

### Server management

| Command | Description |
|---|---|
| `Codebase Memory: Start Server` | Starts the MCP server process |
| `Codebase Memory: Stop Server` | Stops the running server |

The server starts automatically if `codebase-memory.autoStart` is enabled (default: on).

### Indexing

| Command | Description |
|---|---|
| `Codebase Memory: Index Repository` | Select a folder and build/update its graph index |
| `Codebase Memory: List Indexed Projects` | Shows all indexed projects in an output panel |
| `Codebase Memory: Delete Project Index` | Remove a project's graph data |

### Search & trace

| Command | Description |
|---|---|
| `Codebase Memory: Search Graph` | Search indexed symbols by name pattern (regex) and optional node label filter. Results appear in the sidebar under **Search Results** and in an output panel. |
| `Codebase Memory: Search Graph at Cursor` | Same as above, using the symbol under cursor. Results populate the **Search Results** view. |
| `Codebase Memory: BM25 Full-Text Search` | Full-text search using BM25 ranking with camelCase-aware tokenization — finds code even when you don't know the exact symbol name. Results ranked by relevance with structural boosting. |
| `Codebase Memory: BM25 Full-Text Search at Cursor` | Runs BM25 search on the selected text or word under cursor. |
| `Codebase Memory: Semantic Vector Search` | Embedding-powered semantic search. Enter comma-separated keywords (e.g. `send,pubsub,publish`). Finds functions that score well on ALL keywords via per-keyword min-cosine scoring. Requires moderate/full index mode. Results appear in **Search Results** with similarity scores. |
| `Codebase Memory: Semantic Vector Search at Cursor` | Semantic search using the word under cursor as a single keyword query. |
| `Codebase Memory: Graph-Augmented Code Search` | Grep-like text search within indexed project files. Results are deduplicated into containing functions and enriched with graph metadata (in/out degree, call relationships). |
| `Codebase Memory: Graph-Augmented Code Search at Cursor` | Code search using the selected text or word under cursor. |
| `Codebase Memory: Trace Call Path` | Trace callers/callees of a function up to 3 levels deep (inbound, outbound, or both). Results populate the **Search Results** view. |
| `Codebase Memory: Get Code Snippet` | Retrieve source code for a symbol by qualified name |

All search commands fall back to VS Code's standard **Find in Files** (`Ctrl+Shift+F`) when the graph returns no results (except semantic search, which shows a "no matches" message instead).

All trace/snippet commands prompt for a project first. See "Project awareness" below.

### Smart cursor commands

| Command | Description |
|---|---|
| `Codebase Memory: Search Graph at Cursor` | Searches the symbol under cursor (regex-escaped) with optional label filter |
| `Codebase Memory: Trace Call Path at Cursor` | Traces the function name under cursor, then asks direction |
| `Codebase Memory: Get Code Snippet at Cursor` | Fetches source for the qualified name under cursor |
| `Codebase Memory: Create Saved Query from Symbol` | Opens the Query Editor pre-filled with a Cypher query targeting the symbol under cursor |

All smart cursor commands automatically select a project first — they check your active editor's workspace folder and match it against indexed projects. If no match is found (or multiple projects exist), you are prompted to pick one.

These are also available in the right-click context menu under **Codebase Memory**.

### Saved queries

| Command | Description |
|---|---|
| `Codebase Memory: Open Query Editor` | Open the query editor webview to write, test, and save custom Cypher queries |
| `Codebase Memory: Run Saved Query` | Pick and run a saved query. Use `{{word}}` (cursor symbol) and `{{project}}` (workspace name) as template placeholders |
| `Codebase Memory: Execute Cypher Query` | Run a one-off raw Cypher query |

### Architecture

| Command | Description |
|---|---|
| `Codebase Memory: Show Architecture` | Project overview: languages, packages, entry points, routes, hotspots, and module boundaries |
| `Codebase Memory: Show Graph Schema` | Node types and edge counts for a project |
| `Codebase Memory: Detect Changes` | Compares working tree against the last indexed state (uses active workspace folder) |

Architecture and Schema prompts for project selection. Change detection uses the active workspace folder.

### Advanced

| Command | Description |
|---|---|
| `Codebase Memory: Open 3D Graph View` | Open the interactive 3D graph visualization panel |

---

## Project awareness

Most search, trace, and snippet commands operate on a single project. When you run one of these commands the extension:

1. Lists all indexed projects from the server
2. **Auto-selects** if only one project exists
3. **Checks your active editor** — if the workspace folder name matches an indexed project, it picks that one without prompting
4. Otherwise, shows a **quick pick** for you to choose

Commands that require project context:

| Command | Auto-detects workspace folder |
|---|---|
| Search Graph (palette) | ✓ |
| Search Graph at Cursor | ✓ |
| Trace Call Path (palette) | ✓ |
| Trace Call Path at Cursor | ✓ |
| Get Code Snippet (palette) | ✓ |
| Get Code Snippet at Cursor | ✓ |
| Execute Cypher Query | ✓ |
| Run Saved Query | ✓ |
| Show Architecture | ✓ |
| Show Graph Schema | ✓ |
| Delete Project Index | ✓ |

Commands that do **not** require a project: Index Repository, List Indexed Projects, Open 3D Graph View, Detect Changes, Open Query Editor.

## Right-click context menu

Right-click any symbol in the editor to access a **Codebase Memory** submenu:

| Item | Description |
|---|---|
| **Search Graph at Cursor** | Regex search for the word under cursor |
| **Trace Call Path at Cursor** | BFS trace — asks for direction |
| **Get Code Snippet at Cursor** | Fetch source by qualified name |
| **BM25 Full-Text Search at Cursor** | BM25-ranked full-text search of the word |
| **Semantic Vector Search at Cursor** | Vector similarity search for the word |
| **Graph-Augmented Code Search at Cursor** | Grep + graph enrichment for the word |
| **Run Saved Query** | Pick and execute a saved custom query |
| **Create Saved Query from Symbol** | Open Query Editor pre-filled targeting the symbol |

## Keyboard shortcuts

| Key | Command |
|---|---|
| `Ctrl+Alt+G` | Search Graph at Cursor |
| `Ctrl+Alt+T` | Trace Call Path at Cursor |
| `Ctrl+Alt+Shift+S` | Get Code Snippet at Cursor |
| `Ctrl+Alt+B` | BM25 Full-Text Search at Cursor |
| `Ctrl+Alt+V` | Semantic Vector Search at Cursor |
| `Ctrl+Alt+Shift+F` | Graph-Augmented Code Search at Cursor |
| `Ctrl+Alt+Q` | Run Saved Query |
| `Ctrl+Alt+Shift+Q` | Create Saved Query from Symbol |

All keybindings are configurable via `Preferences: Open Keyboard Shortcuts`.

## Custom saved queries

You can write, test, and save Cypher queries for reuse, each optionally bound to a keybinding.

### Query Editor

Run `Codebase Memory: Open Query Editor` to open the query editor webview:

1. **Write** your Cypher query in the editor area
2. **Run** (or `Ctrl+Enter`) to test it against the running server
3. **Name** the query and optionally assign a **keybinding** (e.g. `ctrl+alt+1`)
4. **Save** — the query is persisted in VS Code settings

**Template variables** in saved queries:
- `{{word}}` — replaced with the symbol under cursor when invoked
- `{{project}}` — replaced with the selected project name (not just workspace folder)

### Running saved queries

- Via the **Command Palette**: `Codebase Memory: Run Saved Query`
- Via the **right-click menu**: Codebase Memory → Run Saved Query
- Via **assigned keybinding**: if you saved a query with a key like `ctrl+alt+1`, pressing that runs it directly

When you run a saved query, the extension first selects a project (auto-detects workspace folder if matching), then substitutes template variables (`{{word}}`, `{{project}}`), and passes the project to the server.

### Conflict detection

When saving a query with a keybinding, the editor checks against common VS Code shortcuts and shows a warning if a conflict is detected. Use `File > Preferences > Keyboard Shortcuts` to resolve any conflicts.

### Example saved queries

```
# Find all functions that call a specific function
MATCH (f:Function)-[:CALLS]->(g:Function {name: "{{word}}"})
RETURN f.name, f.file_path

# Show project structure
MATCH (p:Package)-[:CONTAINS]->(m:Module)
RETURN p.name, collect(m.name) AS modules
LIMIT 30
```

---

## Sidebar tree view

The **Codebase Memory** activity bar tab shows two sections:

### Projects

Each indexed project is listed here. Right-click a project to:
- **Delete Project Index** — remove it from the graph
- **Open 3D Graph View** — visualize that project's graph

Click the title-bar buttons (+ and graph icon) for the same actions. Use the **"Index a repository..."** entry at the bottom to add a new project.

### Search Results

When you run any search or trace command, the results appear in this section. Each result shows the symbol name, its node label, the file path, and (when available) the line number.

**Click any result** to open the file at the correct line — the cursor jumps to the start of the matched function or symbol. For `search_code` results, individual grep match lines are shown.

Sources that populate the Search Results view:
- **Search Graph** / **Search Graph at Cursor** — regex name pattern matches
- **BM25 Full-Text Search** — BM25-ranked text matches
- **Semantic Vector Search** — vector similarity results with scores
- **Graph-Augmented Code Search** — enriched grep results, one per containing function
- **Trace Call Path** — extracted function names from the call tree
- **Trace Call Path at Cursor** — same, for the word under cursor

- The section title shows the search query used
- Click the **clear** button (X icon) in the title bar to clear results
- The search results view opens automatically when a search completes

---

## 3D graph visualization

Run `Codebase Memory: Open 3D Graph View` to open an interactive 3D graph panel. The panel embeds the binary's built-in HTTP visualization UI.

- **Search** — type a symbol name and press Enter to highlight nodes
- **Refresh** — reload the graph view
- **Project selection** — right-click a project in the sidebar and choose "Open 3D Graph View" to scope the view

The panel auto-detects whether the HTTP server is running and shows a fallback message if unreachable.

---

## Search panel integration

You can also search the knowledge graph directly from VS Code's search panel (`Ctrl+Shift+F`). Select **"codebase-memory"** from the provider dropdown (next to the search input), type a symbol name, and press Enter. Results appear inline in the search view, grouped under the **codebase-memory** section. This uses the graph's BM25 ranking internally, so searches are full-text and camelCase-aware.

This works alongside the regular file search — switch between providers in the dropdown to alternate between searching files and searching the graph.

## Hover code intelligence

Hover over any symbol name in your code while the server is running. A tooltip shows matching graph entries (name, node label, file path) fetched from the index, up to 5 results. The hover uses the active file's workspace folder name as the project scope — no project prompt appears since hover is non-interactive.

---

## Typical workflows

### Explore a new project
1. **Index Repository** — build the graph
2. **Show Architecture** — get a high-level view (languages, packages, entry points)
3. **Show Graph Schema** — see what node types were extracted

### Understand a function

1. **BM25 Full-Text Search** with descriptive keywords (e.g. `update settings`) to find relevant code even when you don't know the symbol name
2. **Search Graph** with `.*functionName.*` to locate it by exact name
3. **Trace Call Path** to find callers and callees
4. **Get Code Snippet** to view the source
5. **Semantic Vector Search** to discover related functions by conceptual similarity

### Track impact of changes
1. Index the repository initially
2. Make edits
3. Run **Detect Changes** to see affected files and symbols with risk levels

### Custom graph queries
Use **Execute Cypher Query** for ad-hoc analysis:

```
MATCH (f:Function)-[:CALLS]->(g:Function)
WHERE f.name CONTAINS "Handler"
RETURN f.name, g.name
LIMIT 20
```

---

## Settings reference

| Setting | Default | Description |
|---|---|---|
| `codebase-memory.binaryPath` | `""` | Explicit path to the binary (auto-search PATH if empty) |
| `codebase-memory.graphPort` | `9749` | Port for the 3D graph HTTP server |
| `codebase-memory.autoStart` | `true` | Auto-start server on VS Code launch |
| `codebase-memory.customQueries` | `[]` | Saved queries with optional keybindings (use `{{word}}`, `{{project}}` placeholders) |

---

## Logs and debugging

- **Output channel**: `Ctrl+Shift+U` → select **"Codebase Memory"** from the dropdown. Shows server stderr and extension diagnostics.
- **Status bar**: Shows **Codebase Memory** (green = running, grey = stopped, spinning = starting). Click to start or open the graph.
