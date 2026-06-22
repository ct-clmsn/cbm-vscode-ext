import { spawn } from "child_process";
import * as vscode from "vscode";
import { McpClient } from "./mcpClient";
import { ProjectsTreeDataProvider, SearchResultsProvider } from "./treeDataProvider";
import { GraphWebviewProvider } from "./graphEditorProvider";
import { QueryEditorProvider } from "./queryEditorProvider";
import { registerCommands } from "./commands";
import { registerHoverProvider } from "./hoverProvider";
import { registerGraphSearchProvider } from "./searchProvider";
import { registerLmTools } from "./lmTools";

let client: McpClient;
let treeProvider: ProjectsTreeDataProvider;
let searchResultsProvider: SearchResultsProvider;
let graphProvider: GraphWebviewProvider;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let serverRunning = false;

function log(msg: string): void {
  outputChannel.appendLine(msg);
  console.log(`[cbm] ${msg}`);
}

async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("Codebase Memory");
  ctx.subscriptions.push(outputChannel);
  log("Extension activated");

  client = new McpClient((msg: string) => log(msg));
  registerLmTools(ctx, client);
  treeProvider = new ProjectsTreeDataProvider(client);
  searchResultsProvider = new SearchResultsProvider();
  graphProvider = new GraphWebviewProvider(ctx.extensionUri);
  const queryEditorProvider = new QueryEditorProvider(ctx.extensionUri, client);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    0,
  );
  statusBarItem.command = "codebase-memory.startServer";
  updateStatusBar(false);
  statusBarItem.show();
  ctx.subscriptions.push(statusBarItem);

  vscode.window.registerTreeDataProvider(
    "codebase-memory.projects",
    treeProvider,
  );

  vscode.window.registerTreeDataProvider(
    "codebase-memory.searchResults",
    searchResultsProvider,
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("codebase-memory.searchResults.clear", () => {
      searchResultsProvider.clear();
    }),
  );

  try {
    registerGraphSearchProvider(ctx, client);
  } catch (err) {
    log(`Search provider registration failed (non-fatal): ${err}`);
  }

  const startServer = async () => {
    if (serverRunning) {
      vscode.window.showInformationMessage("Codebase Memory server is already running");
      return;
    }

    const binaryPath = await findBinary();
    if (!binaryPath) {
      log("Binary not found");
      vscode.window
        .showErrorMessage(
          "codebase-memory-mcp binary not found. Install it first, or set 'codebase-memory.binaryPath' in settings.",
          "Install Instructions",
          "Open Settings",
        )
        .then((action) => {
          if (action === "Install Instructions") {
            vscode.env.openExternal(
              vscode.Uri.parse(
                "https://github.com/DeusData/codebase-memory-mcp#quick-start",
              ),
            );
          } else if (action === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "codebase-memory.binaryPath",
            );
          }
        });
      return;
    }

    log(`Starting server: ${binaryPath}`);
    updateStatusBar(true, "starting");

    try {
      const port = getGraphPort();
      await client.start(binaryPath, ["--ui", "--port", String(port)]);
      serverRunning = true;
      updateStatusBar(true);
      log("Server started");

      treeProvider.loadProjects();

      vscode.window.showInformationMessage(
        "Codebase Memory server started",
      );
    } catch (err) {
      serverRunning = false;
      updateStatusBar(false);
      const msg = err instanceof Error ? err.message : String(err);
      log(`Server failed to start: ${msg}`);
      vscode.window.showErrorMessage(
        `Codebase Memory: ${msg}. Check the output channel for details.`,
      );
      outputChannel.show();
    }
  };

  const stopServer = async () => {
    if (!serverRunning) {
      return;
    }
    await client.stop();
    serverRunning = false;
    updateStatusBar(false);
    vscode.window.showInformationMessage("Codebase Memory server stopped");
  };

  const getGraphPort = () => {
    return vscode.workspace
      .getConfiguration("codebase-memory")
      .get("graphPort", 9749);
  };

  const openGraphPanel = (project?: string) => {
    graphProvider.open(project);
  };

  const openQueryEditor = (initialQuery?: string) => queryEditorProvider.open(undefined, initialQuery);
  registerCommands(ctx, client, startServer, stopServer, getGraphPort, openGraphPanel, openQueryEditor, searchResultsProvider);
  registerHoverProvider(ctx, client);

  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("codebase-memory.binaryPath")) {
        if (serverRunning) {
          stopServer().then(() => startServer());
        }
      }
    }),
  );

  const autoStart = vscode.workspace
    .getConfiguration("codebase-memory")
    .get("autoStart", true);
  if (autoStart) {
    startServer();
  }
}

function deactivate(): void {
  if (client) {
    client.stop().catch(() => {});
  }
}

async function findBinary(): Promise<string | undefined> {
  const configured = vscode.workspace
    .getConfiguration("codebase-memory")
    .get<string>("binaryPath", "");

  if (configured) {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(configured));
      return configured;
    } catch {
      vscode.window.showWarningMessage(
        `Configured binary not found at "${configured}". Falling back to PATH search.`,
      );
    }
  }

  const candidates = ["codebase-memory-mcp", "codebase-memory-mcp-ui"];

  for (const name of candidates) {
    try {
      const result = await findOnPath(name);
      if (result) return result;
    } catch {
      continue;
    }
  }

  return undefined;
}

async function findOnPath(name: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "where" : "which";
    const proc = spawn(cmd, [name]);
    let output = "";
    proc.stdout!.on("data", (d: Buffer) => {
      output += d.toString();
    });
    proc.on("close", (code: number) => {
      resolve(code === 0 ? output.trim().split("\n")[0].trim() : undefined);
    });
    proc.on("error", () => resolve(undefined));
  });
}

module.exports = { activate, deactivate };

function updateStatusBar(running: boolean, state?: string): void {
  if (running && state === "starting") {
    statusBarItem.text = "$(sync~spin) Codebase Memory...";
    statusBarItem.tooltip = "Starting server...";
    statusBarItem.backgroundColor = undefined;
    return;
  }

  if (running) {
    statusBarItem.text = "$(graph) Codebase Memory";
    statusBarItem.tooltip = "Codebase Memory server is running";
    statusBarItem.command = "codebase-memory.openGraphPanel";
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.prominentBackground",
    );
  } else {
    statusBarItem.text = "$(debug-disconnect) Codebase Memory";
    statusBarItem.tooltip = "Click to start server";
    statusBarItem.command = "codebase-memory.startServer";
    statusBarItem.backgroundColor = undefined;
  }
}
