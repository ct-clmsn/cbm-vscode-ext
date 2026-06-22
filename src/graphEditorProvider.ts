import * as vscode from "vscode";

export class GraphWebviewProvider {
  public static readonly viewType = "codebase-memory.graphPanel";

  private panel: vscode.WebviewPanel | undefined;
  private graphPort: number;
  private projectName: string | undefined;

  constructor(private extensionUri: vscode.Uri) {
    this.graphPort = vscode.workspace
      .getConfiguration("codebase-memory")
      .get("graphPort", 9749);
  }

  open(project?: string): void {
    this.projectName = project;

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      if (project) {
        this.panel.webview.postMessage({
          type: "selectProject",
          project,
        });
      }
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      GraphWebviewProvider.viewType,
      project ? `Graph: ${project}` : "Codebase Memory Graph",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );

    this.panel.webview.html = this.getHtmlContent();

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  private getHtmlContent(): string {
    const graphUrl = `http://localhost:${this.graphPort}`;
    const projectParam = this.projectName
      ? `?project=${encodeURIComponent(this.projectName)}`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://localhost:${this.graphPort}; connect-src http://localhost:${this.graphPort}; script-src 'unsafe-inline'; style-src 'unsafe-inline';" />
  <title>Codebase Memory Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; background: #0a0a10; color: #e4e4ed; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
    body { display: flex; flex-direction: column; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: #0e1a1e; border-bottom: 1px solid #1a3a4030; min-height: 36px; }
    header h1 { font-size: 12px; font-weight: 600; color: #1DA27E; }
    .controls { display: flex; gap: 6px; align-items: center; }
    .controls input { background: #1a2a2e; border: 1px solid #1a3a4030; border-radius: 4px; padding: 3px 8px; color: #e0eded; font-size: 11px; width: 200px; outline: none; }
    .controls button { background: #1DA27E20; border: 1px solid #1DA27E40; color: #1DA27E; border-radius: 4px; padding: 3px 10px; font-size: 11px; cursor: pointer; }
    .controls button:hover { background: #1DA27E30; }
    .controls .error { color: #e05252; font-size: 11px; }
    iframe { flex: 1; border: none; width: 100%; }
    .fallback { flex: 1; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; }
    .fallback p { color: #6a9e9e; font-size: 13px; }
    .fallback code { background: #1a2a2e; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    .spinner { width: 24px; height: 24px; border: 2px solid #1DA27E20; border-top-color: #1DA27E; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <header>
    <h1>Codebase Memory Graph</h1>
    <div class="controls">
      <input id="searchInput" type="text" placeholder="Search symbol..." />
      <button id="searchBtn">Search</button>
      <button id="refreshBtn">Refresh</button>
      <span id="statusText" class="error"></span>
    </div>
  </header>
  <iframe id="graphFrame" src="${graphUrl}/${projectParam}" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>
  <div class="fallback" id="fallback" style="display:none;">
    <div class="spinner"></div>
    <p>Starting graph server...</p>
    <p>If this persists, ensure you have the UI binary variant and it is running at <code>${graphUrl}</code></p>
  </div>
  <script>
    (function() {
      const iframe = document.getElementById('graphFrame');
      const fallback = document.getElementById('fallback');
      const statusText = document.getElementById('statusText');
      const searchInput = document.getElementById('searchInput');
      const searchBtn = document.getElementById('searchBtn');
      const refreshBtn = document.getElementById('refreshBtn');

      function checkServer() {
        fetch('${graphUrl}/', { method: 'HEAD', mode: 'no-cors' })
          .then(() => {
            iframe.style.display = 'block';
            fallback.style.display = 'none';
            statusText.textContent = '';
          })
          .catch(() => {
            iframe.style.display = 'none';
            fallback.style.display = 'flex';
            statusText.textContent = 'Server unreachable';
            setTimeout(checkServer, 2000);
          });
      }

      checkServer();

      refreshBtn.addEventListener('click', () => {
        iframe.src = iframe.src;
      });

      searchBtn.addEventListener('click', () => {
        const q = searchInput.value.trim();
        if (q) {
          iframe.contentWindow.postMessage({ type: 'search', query: q }, '*');
        }
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchBtn.click();
      });

      window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'selectProject') {
          iframe.src = '${graphUrl}/?project=' + encodeURIComponent(e.data.project);
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}
