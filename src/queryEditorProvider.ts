import * as vscode from "vscode";
import { McpClient } from "./mcpClient";

interface SavedQuery {
  id: string;
  name: string;
  query: string;
  key: string;
}

export class QueryEditorProvider {
  public static readonly viewType = "codebase-memory.queryEditor";

  private panel: vscode.WebviewPanel | undefined;
  private currentQueryId: string | undefined;
  private currentQuery = "";
  private currentKey = "";

  constructor(
    private extensionUri: vscode.Uri,
    private client: McpClient,
  ) {}

  open(queryId?: string, initialQuery?: string): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      if (queryId) {
        this.loadQuery(queryId);
      } else if (initialQuery !== undefined) {
        this.setInitialQuery(initialQuery);
      }
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      QueryEditorProvider.viewType,
      "Cypher Query Editor",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );

    this.panel.webview.html = this.getHtmlContent();
    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    if (queryId) {
      this.loadQuery(queryId);
    } else if (initialQuery !== undefined) {
      this.setInitialQuery(initialQuery);
    }
  }

  private setInitialQuery(query: string): void {
    this.currentQuery = query;
    if (this.panel) {
      this.panel.webview.postMessage({
        type: "setQuery",
        query,
      });
    }
  }

  private async loadQuery(id: string): Promise<void> {
    const queries = this.getSavedQueries();
    const q = queries.find((q) => q.id === id);
    if (q && this.panel) {
      this.currentQueryId = q.id;
      this.currentQuery = q.query;
      this.currentKey = q.key;
      this.panel.webview.postMessage({
        type: "loadQuery",
        id: q.id,
        name: q.name,
        query: q.query,
        key: q.key,
      });
    }
  }

  private getSavedQueries(): SavedQuery[] {
    return vscode.workspace
      .getConfiguration("codebase-memory")
      .get<SavedQuery[]>("customQueries", []);
  }

  private async saveQueries(queries: SavedQuery[]): Promise<void> {
    await vscode.workspace
      .getConfiguration("codebase-memory")
      .update("customQueries", queries, vscode.ConfigurationTarget.Global);
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case "run": {
        if (!this.client.ready) {
          this.postMessage("result", { error: "Server not running. Start it first." });
          return;
        }
        try {
          const result = await this.client.callTool("query_graph", { query: msg.query });
          this.postMessage("result", { data: result });
        } catch (err) {
          this.postMessage("result", {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }
      case "save": {
        const queries = this.getSavedQueries();
        const existing = queries.findIndex((q) => q.id === msg.id);
        const entry: SavedQuery = {
          id: msg.id || `q_${Date.now()}`,
          name: msg.name,
          query: msg.query,
          key: msg.key || "",
        };

        if (existing >= 0) {
          queries[existing] = entry;
        } else {
          queries.push(entry);
        }

        if (entry.key) {
          this.checkKeyConflict(entry.key);
        }

        await this.saveQueries(queries);
        this.currentQueryId = entry.id;
        this.postMessage("saved", { id: entry.id, queries: this.queriesToPickItems(queries) });
        break;
      }
      case "delete": {
        let queries = this.getSavedQueries();
        queries = queries.filter((q) => q.id !== msg.id);
        await this.saveQueries(queries);
        this.postMessage("deleted", { queries: this.queriesToPickItems(queries) });
        break;
      }
      case "listQueries": {
        const queries = this.getSavedQueries();
        this.postMessage("queryList", { queries: this.queriesToPickItems(queries) });
        break;
      }
      case "loadById": {
        await this.loadQuery(msg.id);
        break;
      }
    }
  }

  private postMessage(type: string, payload: Record<string, unknown>): void {
    this.panel?.webview.postMessage({ type, ...payload });
  }

  private queriesToPickItems(queries: SavedQuery[]): { id: string; name: string; key: string; query: string }[] {
    return queries.map((q) => ({
      id: q.id,
      name: q.name,
      key: q.key,
      query: q.query.slice(0, 80) + (q.query.length > 80 ? "..." : ""),
    }));
  }

  private checkKeyConflict(key: string): void {
    const knownConflicts: Record<string, string> = {
      "ctrl+c": "Copy",
      "ctrl+v": "Paste",
      "ctrl+x": "Cut",
      "ctrl+z": "Undo",
      "ctrl+s": "Save",
      "ctrl+f": "Find",
      "ctrl+h": "Find and Replace",
      "ctrl+shift+f": "Search in Files",
      "ctrl+`": "Toggle Terminal",
      "ctrl+shift+`": "Create New Terminal",
      "ctrl+p": "Go to File",
      "ctrl+shift+p": "Command Palette",
      "ctrl+b": "Toggle Sidebar",
      "ctrl+shift+b": "Build Task",
      "f5": "Start Debugging",
      "shift+f5": "Stop Debugging",
      "ctrl+f5": "Run Without Debugging",
    };
    const normalized = key.toLowerCase().trim();
    if (knownConflicts[normalized]) {
      this.postMessage("keyConflict", {
        key,
        existing: knownConflicts[normalized],
        message: `Warning: "${key}" is used by VS Code for "${knownConflicts[normalized]}". Use Keyboard Shortcuts editor to resolve conflicts.`,
      });
    }
  }

  getHtmlContent(): string {
    const queries = this.getSavedQueries();
    const queryListJson = JSON.stringify(this.queriesToPickItems(queries));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<title>Cypher Query Editor</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0d1117; color: #e6edf3; height: 100vh; display: flex; flex-direction: column; font-size: 13px; }
  .toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: #161b22; border-bottom: 1px solid #30363d; flex-shrink: 0; }
  .toolbar select { background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 4px; padding: 3px 6px; font-size: 12px; flex: 1; max-width: 300px; }
  .toolbar button { background: #1f6feb; color: #fff; border: none; border-radius: 4px; padding: 4px 12px; font-size: 12px; cursor: pointer; }
  .toolbar button:hover { background: #388bfd; }
  .toolbar .danger { background: #da3633; }
  .toolbar .danger:hover { background: #f85149; }
  .toolbar .secondary { background: #21262d; border: 1px solid #30363d; color: #e6edf3; }
  .toolbar .secondary:hover { background: #30363d; }
  .editor-area { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .query-header { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #0d1117; border-bottom: 1px solid #21262d; flex-shrink: 0; }
  .query-header input { background: #0d1117; border: 1px solid #30363d; border-radius: 4px; padding: 3px 8px; color: #e6edf3; font-size: 12px; }
  .query-header input[type="text"] { flex: 1; }
  .query-header input[type="text"]::placeholder { color: #484f58; }
  .query-header input[type="text"]:focus { border-color: #1f6feb; outline: none; }
  .query-header label { color: #8b949e; font-size: 11px; }
  .query-header .key-input { width: 140px; font-family: monospace; }
  textarea { flex: 1; background: #0d1117; color: #e6edf3; border: none; padding: 10px; font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace; font-size: 13px; line-height: 1.5; resize: none; outline: none; tab-size: 2; }
  textarea::placeholder { color: #484f58; }
  .results { border-top: 1px solid #21262d; background: #0d1117; flex-shrink: 0; max-height: 40%; overflow: auto; }
  .results-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px; background: #161b22; border-bottom: 1px solid #21262d; font-size: 11px; color: #8b949e; }
  .results-header .clear-btn { background: none; border: none; color: #8b949e; cursor: pointer; font-size: 11px; }
  .results-header .clear-btn:hover { color: #e6edf3; }
  .results-content { padding: 8px 10px; font-family: 'Cascadia Code', Consolas, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-x: auto; }
  .results-content .error { color: #f85149; }
  .results-content .success { color: #3fb950; }
  .results-content .json { color: #79c0ff; }
  .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #484f58; font-size: 13px; }
  .conflict-bar { background: #d29922; color: #0d1117; padding: 4px 10px; font-size: 11px; display: none; }
</style>
</head>
<body>
  <div class="toolbar">
    <select id="savedSelect">
      <option value="">-- Saved Queries --</option>
    </select>
    <button id="loadBtn" class="secondary">Load</button>
    <button id="deleteBtn" class="danger" disabled>Delete</button>
    <span style="flex:1"></span>
    <button id="runBtn">Run Query</button>
  </div>
  <div class="conflict-bar" id="conflictBar"></div>
  <div class="editor-area">
    <div class="query-header">
      <input type="text" id="queryName" placeholder="Query name..." />
      <label>Key:</label>
      <input type="text" id="queryKey" class="key-input" placeholder="e.g. ctrl+alt+q" />
      <button id="saveBtn" class="secondary">Save</button>
    </div>
    <textarea id="queryInput" placeholder="MATCH (f:Function)-[:CALLS]->(g) RETURN f.name, g.name LIMIT 20" spellcheck="false"></textarea>
    <div class="results" id="resultsPanel">
      <div class="results-header">
        <span>Results</span>
        <button class="clear-btn" id="clearBtn">Clear</button>
      </div>
      <div class="results-content" id="resultsContent"><span class="empty">Run a query to see results</span></div>
    </div>
  </div>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      const queryInput = document.getElementById('queryInput');
      const queryName = document.getElementById('queryName');
      const queryKey = document.getElementById('queryKey');
      const resultsContent = document.getElementById('resultsContent');
      const savedSelect = document.getElementById('savedSelect');
      const runBtn = document.getElementById('runBtn');
      const saveBtn = document.getElementById('saveBtn');
      const deleteBtn = document.getElementById('deleteBtn');
      const loadBtn = document.getElementById('loadBtn');
      const clearBtn = document.getElementById('clearBtn');
      const conflictBar = document.getElementById('conflictBar');
      let currentId = '';
      let queryList = ${queryListJson};

      function updateSavedSelect() {
        const val = savedSelect.value;
        savedSelect.innerHTML = '<option value="">-- Saved Queries --</option>';
        for (const q of queryList) {
          const opt = document.createElement('option');
          opt.value = q.id;
          opt.textContent = q.name + (q.key ? ' [' + q.key + ']' : '');
          savedSelect.appendChild(opt);
        }
        savedSelect.value = val;
        deleteBtn.disabled = !currentId;
      }

      function setResult(data, isError) {
        if (isError) {
          resultsContent.innerHTML = '<span class="error">' + escapeHtml(data) + '</span>';
        } else {
          const json = JSON.stringify(data, null, 2);
          resultsContent.innerHTML = '<span class="json">' + escapeHtml(json) + '</span>';
        }
      }

      function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      runBtn.addEventListener('click', () => {
        const q = queryInput.value.trim();
        if (!q) return;
        resultsContent.innerHTML = '<span style="color:#8b949e">Running...</span>';
        vscode.postMessage({ type: 'run', query: q });
      });

      saveBtn.addEventListener('click', () => {
        const q = queryInput.value.trim();
        const name = queryName.value.trim() || 'Unnamed Query';
        const key = queryKey.value.trim();
        if (!q) return;
        vscode.postMessage({ type: 'save', id: currentId, name, query: q, key });
      });

      deleteBtn.addEventListener('click', () => {
        if (currentId) {
          vscode.postMessage({ type: 'delete', id: currentId });
        }
      });

      loadBtn.addEventListener('click', () => {
        const id = savedSelect.value;
        if (id) {
          vscode.postMessage({ type: 'loadById', id });
        }
      });

      clearBtn.addEventListener('click', () => {
        resultsContent.innerHTML = '<span class="empty">Run a query to see results</span>';
      });

      queryInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          runBtn.click();
        }
      });

      window.addEventListener('message', (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'result':
            if (msg.error) setResult(msg.error, true);
            else setResult(msg.data, false);
            break;
          case 'saved':
            currentId = msg.id;
            queryList = msg.queries;
            updateSavedSelect();
            deleteBtn.disabled = false;
            break;
          case 'deleted':
            currentId = '';
            queryList = msg.queries;
            updateSavedSelect();
            break;
          case 'queryList':
            queryList = msg.queries;
            updateSavedSelect();
            break;
          case 'setQuery':
            queryInput.value = msg.query || '';
            queryName.value = '';
            queryName.placeholder = 'Name this query...';
            currentId = '';
            queryKey.value = '';
            break;
          case 'loadQuery':
            currentId = msg.id;
            queryName.value = msg.name || '';
            queryInput.value = msg.query || '';
            queryKey.value = msg.key || '';
            savedSelect.value = msg.id;
            deleteBtn.disabled = false;
            break;
          case 'keyConflict':
            conflictBar.textContent = msg.message;
            conflictBar.style.display = 'block';
            setTimeout(() => { conflictBar.style.display = 'none'; }, 6000);
            break;
        }
      });

      updateSavedSelect();
    })();
  </script>
</body>
</html>`;
  }
}
