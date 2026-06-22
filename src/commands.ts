import * as vscode from "vscode";
import { McpClient } from "./mcpClient";
import type { ArchitectureInfo, ChangeInfo, SchemaInfo, SearchGraphResponse, SearchCodeResult } from "./types";
import { SearchResultsProvider } from "./treeDataProvider";

let _lastProjectRoot = "";

function getProjectRoot(project: string, projects: { name: string; root_path: string }[]): string {
  const p = projects.find((x) => x.name === project);
  return p?.root_path ?? "";
}

function showOutput(data: string, title: string): void {
  const channel = vscode.window.createOutputChannel(`Codebase Memory - ${title}`);
  channel.replace(data);
  channel.show();
}

function truncateJson(text: string, maxLen = 8000): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "\n\n... (truncated)" : text;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fallbackTextSearch(word: string): void {
  vscode.commands.executeCommand("workbench.action.findInFiles", { query: word });
}

function extractTraceItems(obj: unknown, depth = 0, seen = new Set<number>()): { name: string; label: string; file_path?: string }[] {
  if (!obj || typeof obj !== "object" || depth > 10) return [];
  const items: { name: string; label: string; file_path?: string }[] = [];

  if (Array.isArray(obj)) {
    for (const item of obj) {
      items.push(...extractTraceItems(item, depth + 1, seen));
    }
    return items;
  }

  const record = obj as Record<string, unknown>;

  const name = record["name"] ?? record["function_name"] ?? record["node"];
  if (typeof name === "string") {
    const label = (record["label"] ?? record["type"] ?? record["direction"]) as string | undefined;
    const file_path = record["file_path"] ?? record["file"] as string | undefined;
    const key = name + label;
    if (!seen.has(hashCode(key))) {
      seen.add(hashCode(key));
      items.push({ name, label: label ?? "Function", file_path: file_path ?? "" });
    }
  }

  for (const val of Object.values(record)) {
    items.push(...extractTraceItems(val, depth + 1, seen));
  }

  return items;
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}

async function selectProject(client: McpClient): Promise<{ name: string; root_path: string } | undefined> {
  try {
    const result = await client.callTool<{ projects: { name: string; root_path: string }[] }>("list_projects");
    const projects = result.projects ?? [];
    if (projects.length === 0) {
      vscode.window.showInformationMessage("No indexed projects");
      return;
    }
    if (projects.length === 1) {
      _lastProjectRoot = projects[0].root_path;
      return projects[0];
    }

    const editorUri = vscode.window.activeTextEditor?.document?.uri;
    const workspaceName = editorUri
      ? vscode.workspace.getWorkspaceFolder(editorUri)?.name
      : undefined;

    if (workspaceName) {
      const lower = workspaceName.toLowerCase();
      const match = projects.find((p) =>
        p.name.toLowerCase() === lower ||
        p.name.toLowerCase().includes(lower) ||
        lower.includes(p.name.toLowerCase()),
      );
      if (match) {
        _lastProjectRoot = match.root_path;
        return match;
      }
    }

    const pick = await vscode.window.showQuickPick(
      projects.map((p) => ({
        label: p.name,
        description: p.root_path,
      })),
      { placeHolder: "Select project" },
    );
    if (!pick) return;
    const found = projects.find((p) => p.name === pick.label);
    if (found) {
      _lastProjectRoot = found.root_path;
    }
    return found;
  } catch {
    vscode.window.showErrorMessage("Failed to list projects");
    return;
  }
}

function getWordAtCursor(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (!editor.selection.isEmpty) {
    return editor.document.getText(editor.selection).trim();
  }
  const pos = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(pos, /[\w.]+/);
  if (!wordRange) return;
  return editor.document.getText(wordRange);
}

export function registerCommands(
  ctx: vscode.ExtensionContext,
  client: McpClient,
  startServer: () => Promise<void>,
  stopServer: () => Promise<void>,
  getGraphPort: () => number,
  openGraphPanel: (project?: string) => void,
  openQueryEditor: (initialQuery?: string) => void,
  searchResultsProvider?: SearchResultsProvider,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("codebase-memory.openSearchResult", async (filePath: string, line?: number) => {
      try {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        if (line && line > 0) {
          const pos = new vscode.Position(line - 1, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to open: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("codebase-memory.startServer", startServer),
    vscode.commands.registerCommand("codebase-memory.stopServer", stopServer),

    vscode.commands.registerCommand("codebase-memory.indexRepository", async () => {
      let rootPath: string | undefined;

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        const pick = await vscode.window.showQuickPick(
          workspaceFolders.map((f) => ({
            label: f.name,
            description: f.uri.fsPath,
            path: f.uri.fsPath,
          })),
          { placeHolder: "Select a workspace folder to index (or pick another directory)" },
        );
        rootPath = pick?.path;
      }

      if (!rootPath) {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
          title: "Select repository root to index",
        });
        if (!uris || uris.length === 0) return;
        rootPath = uris[0].fsPath;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Indexing ${rootPath}`,
          cancellable: false,
        },
        async () => {
          try {
            const result = await client.callTool<{ message?: string }>("index_repository", {
              repo_path: rootPath,
            });
            vscode.window.showInformationMessage(
              result?.message ?? "Repository indexed successfully",
            );
          } catch (err) {
            vscode.window.showErrorMessage(
              `Indexing failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        },
      );
    }),

    vscode.commands.registerCommand("codebase-memory.listProjects", async () => {
      try {
        const result = await client.callTool<{ projects: { name: string; root_path: string; indexed_at: string }[] }>(
          "list_projects",
        );
        const projects = result.projects ?? [];
        if (projects.length === 0) {
          vscode.window.showInformationMessage("No indexed projects found");
          return;
        }
        const lines = projects.map(
          (p) => `${p.name}\n  Path: ${p.root_path}\n  Indexed: ${p.indexed_at}`,
        );
        showOutput(lines.join("\n\n"), "Projects");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to list projects: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.deleteProject", async (item?: { project?: { name: string } }) => {
      let projectName: string | undefined = item?.project?.name;

      if (!projectName) {
        try {
          const result = await client.callTool<{ projects: { name: string }[] }>("list_projects");
          const projects = result.projects ?? [];
          if (projects.length === 0) {
            vscode.window.showInformationMessage("No projects to delete");
            return;
          }
          const pick = await vscode.window.showQuickPick(
            projects.map((p) => ({ label: p.name })),
            { placeHolder: "Select project to delete" },
          );
          if (!pick) return;
          projectName = pick.label;
        } catch (err) {
          vscode.window.showErrorMessage(
            `Failed to list projects: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete index for "${projectName}"?`,
        { modal: true },
        "Delete",
      );
      if (confirm !== "Delete") return;

      try {
        await client.callTool("delete_project", { project: projectName });
        vscode.window.showInformationMessage(`Project "${projectName}" deleted`);
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to delete project: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.searchGraph", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const namePattern = await vscode.window.showInputBox({
        prompt: "Symbol name pattern (regex, e.g. .*Handler.*)",
        value: ".*",
      });
      if (namePattern === undefined) return;

      const label = await vscode.window.showInputBox({
        prompt: "Node label (optional: Function, Class, Method, etc.)",
      });

      try {
        const result = await client.callTool<{
          results: { id: number; name: string; label: string; file_path?: string }[];
          total: number;
        }>("search_graph", {
          project: proj.name,
          name_pattern: namePattern,
          ...(label ? { label } : {}),
          limit: 200,
        });

        const items = result.results ?? [];

        if (searchResultsProvider) {
          if (items.length === 0) {
            searchResultsProvider.clear();
          } else {
            searchResultsProvider.setResults(namePattern, items, proj.root_path);
            vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
          }
        }

        if (items.length === 0) {
          vscode.window.showInformationMessage(`No graph matches for "${namePattern}" — falling back to text search`);
          fallbackTextSearch(namePattern);
          return;
        }

        const lines = items.map(
          (r) => `${r.name}  [${r.label}]  ${r.file_path ?? ""}`,
        );
        showOutput(
          `${items.length} result(s)${result.total > items.length ? ` (showing ${items.length} of ${result.total})` : ""}\n\n` +
            lines.join("\n"),
          "Search Graph",
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    // --- BM25 Full-Text Search ---

    vscode.commands.registerCommand("codebase-memory.bm25Search", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const query = await vscode.window.showInputBox({
        prompt: "BM25 full-text search query (camelCase-aware, e.g. update settings)",
        placeHolder: "Enter search terms",
      });
      if (!query) return;

      try {
        const result = await client.callTool<SearchGraphResponse>("search_graph", {
          project: proj.name,
          query,
          limit: 200,
        });

        const items = result.results ?? [];
        if (searchResultsProvider) {
          if (items.length === 0) {
            searchResultsProvider.clear();
          } else {
            searchResultsProvider.setResults(query, items, proj.root_path);
            vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
          }
        }
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No BM25 matches for "${query}" — falling back to text search`);
          fallbackTextSearch(query);
          return;
        }

        const lines = items.map((r) => `${r.name}  [${r.label}]  ${r.file_path ?? ""}`);
        showOutput(`${items.length} BM25 result(s)\n\n${lines.join("\n")}`, "BM25 Search");
      } catch (err) {
        vscode.window.showErrorMessage(`BM25 search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // --- Semantic Vector Search ---

    vscode.commands.registerCommand("codebase-memory.semanticSearch", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const keywords = await vscode.window.showInputBox({
        prompt: "Semantic search keywords (comma-separated, e.g. send,pubsub,publish)",
        placeHolder: "keyword1,keyword2,keyword3",
      });
      if (!keywords) return;
      const terms = keywords.split(",").map((s) => s.trim()).filter(Boolean);
      if (terms.length === 0) return;

      try {
        const result = await client.callTool<SearchGraphResponse>("search_graph", {
          project: proj.name,
          semantic_query: terms,
          limit: 50,
        });

        const items = result.semantic_results ?? [];
        if (searchResultsProvider) {
          if (items.length === 0) {
            searchResultsProvider.clear();
          } else {
            searchResultsProvider.setResults(keywords, items, proj.root_path);
            vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
          }
        }
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No semantic matches for "${keywords}"`);
          return;
        }

        const lines = items.map((r) => `${r.name}  [${r.label}]  (score: ${r.score?.toFixed(3) ?? "?"})  ${r.file_path ?? ""}`);
        showOutput(`${items.length} semantic result(s)\n\n${lines.join("\n")}`, "Semantic Search");
      } catch (err) {
        vscode.window.showErrorMessage(`Semantic search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // --- Graph-Augmented Code Search (grep + graph) ---

    vscode.commands.registerCommand("codebase-memory.codeSearch", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const pattern = await vscode.window.showInputBox({
        prompt: "Search pattern (plain text or regex)",
        placeHolder: "e.g. error handling or def main",
      });
      if (!pattern) return;

      const useRegex = await vscode.window.showQuickPick(
        [
          { label: "No (plain text)", value: false },
          { label: "Yes (regex)", value: true },
        ],
        { placeHolder: "Is the pattern a regex?" },
      );
      if (useRegex === undefined) return;

      const modePick = await vscode.window.showQuickPick(
        [
          { label: "Compact (signatures only)", value: "compact" },
          { label: "Full (with source)", value: "full" },
          { label: "Files (just paths)", value: "files" },
        ],
        { placeHolder: "Output mode" },
      );
      const mode = modePick?.value ?? "compact";

      try {
        const result = await client.callTool<{ results?: SearchCodeResult[]; total_grep_matches?: number; total_results?: number }>(
          "search_code",
          { project: proj.name, pattern, regex: useRegex.value, mode, limit: 20 },
        );

        const items = result.results ?? [];
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No code matches for "${pattern}" — falling back to text search`);
          fallbackTextSearch(pattern);
          return;
        }

        const fileItems = items.map((r) => ({
          name: r.node ?? r.file ?? pattern,
          label: r.label ?? "Match",
          file_path: r.file,
          start_line: r.start_line,
        }));
        searchResultsProvider?.setResults(pattern, fileItems, proj.root_path);
        vscode.commands.executeCommand("workbench.view.extension.codebase-memory");

        const lines = items.map((r) => {
          const header = `${r.node ?? "(match)"}  [${r.label ?? "?"}]  ${r.file ?? ""}${r.start_line ? `:${r.start_line}` : ""}`;
          const ctxTxt = r.context ? `\n  ${r.context.slice(0, 300)}` : "";
          const src = r.source ? `\n${r.source.split("\n").slice(0, 10).map((l) => `  ${l}`).join("\n")}${r.source.split("\n").length > 10 ? "\n  ..." : ""}` : "";
          return header + (ctxTxt || src ? `\n${ctxTxt}${src}` : "");
        });
        showOutput(
          `${items.length} result(s) (${result.total_grep_matches ?? "?"} raw grep matches)\n\n${lines.join("\n\n---\n\n")}`,
          "Code Search",
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Code search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("codebase-memory.tracePath", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const funcName = await vscode.window.showInputBox({
        prompt: "Function name to trace",
      });
      if (!funcName) return;

      const direction = await vscode.window.showQuickPick(
        [
          { label: "Both (callers and callees)", value: "both" },
          { label: "Inbound (who calls this)", value: "inbound" },
          { label: "Outbound (what this calls)", value: "outbound" },
        ],
        { placeHolder: "Trace direction" },
      );
      if (!direction) return;

      try {
        const result = await client.callTool<Record<string, unknown>>("trace_path", {
          project: proj.name,
          function_name: funcName,
          direction: direction.value,
          depth: 3,
        });

        const traceItems = extractTraceItems(result);
        if (traceItems.length > 0) {
          searchResultsProvider?.setResults(funcName, traceItems, proj.root_path);
          vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
        }

        showOutput(JSON.stringify(result, null, 2), "Trace Path");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Trace failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.showArchitecture", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      try {
        const arch = await client.callTool<ArchitectureInfo>("get_architecture", {
          project: proj.name,
        });

        const lines: string[] = [
          `Architecture: ${proj.name}`,
          "",
          "Languages:",
          ...(arch.languages ?? []).map(
            (l) => `  ${l.language}: ${(l.percentage * 100).toFixed(1)}%`,
          ),
          "",
          `Packages (${(arch.packages ?? []).length}):`,
          ...(arch.packages ?? []).slice(0, 50).map((p) => `  ${p}`),
          ...((arch.packages ?? []).length > 50 ? ["  ..."] : []),
          "",
          `Entry Points (${(arch.entry_points ?? []).length}):`,
          ...(arch.entry_points ?? []).map((ep) => `  ${ep}`),
          "",
          `Routes (${(arch.routes ?? []).length}):`,
          ...(arch.routes ?? []).map(
            (r) => `  ${r.method} ${r.path} → ${r.handler}`,
          ),
          "",
          `Hotspots (${(arch.hotspots ?? []).length}):`,
          ...(arch.hotspots ?? []).slice(0, 20).map((h) => `  ${h.name} (score: ${h.score})`),
          "",
          `Boundaries (${(arch.boundaries ?? []).length}):`,
          ...(arch.boundaries ?? []).map(
            (b) => `  ${b.type}: ${b.name} (${b.members.length} members)`,
          ),
        ];

        showOutput(lines.join("\n"), "Architecture");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Architecture query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.showGraphSchema", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      try {
        const schema = await client.callTool<SchemaInfo>("get_graph_schema", {
          project: proj.name,
        });

        const lines: string[] = [
          `Schema: ${proj.name}`,
          `Total nodes: ${schema.total_nodes.toLocaleString()}`,
          `Total edges: ${schema.total_edges.toLocaleString()}`,
          "",
          "Node labels:",
          ...(schema.node_labels ?? []).map(
            (l) => `  ${l.label}: ${l.count.toLocaleString()}`,
          ),
          "",
          "Edge types:",
          ...(schema.edge_types ?? []).map(
            (t) => `  ${t.type}: ${t.count.toLocaleString()}`,
          ),
        ];

        showOutput(lines.join("\n"), "Graph Schema");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to get schema: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.detectChanges", async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showWarningMessage("Open a workspace folder first");
        return;
      }

      try {
        const changes = await client.callTool<ChangeInfo>("detect_changes", {
          project: workspaceFolders[0].name,
        });

        const lines: string[] = [
          "Changes detected:",
          "",
          "Files:",
          ...(changes.files ?? []).map((f) => `  [${f.status}] ${f.path}`),
          "",
          "Affected symbols:",
          ...(changes.affected_symbols ?? []).map(
            (s) => `  ${s.name} (risk: ${s.risk})`,
          ),
          "",
          changes.summary ? `Summary: ${changes.summary}` : "",
        ];

        showOutput(lines.join("\n"), "Changes");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Change detection failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.queryGraph", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const query = await vscode.window.showInputBox({
        prompt: "Cypher query (e.g. MATCH (f:Function) RETURN f.name LIMIT 10)",
        placeHolder: "MATCH (f:Function)-[:CALLS]->(g) RETURN f.name, g.name LIMIT 20",
      });
      if (!query) return;

      try {
        const result = await client.callTool("query_graph", { project: proj.name, query });
        showOutput(truncateJson(JSON.stringify(result, null, 2)), "Cypher Query");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.getCodeSnippet", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const qualifiedName = await vscode.window.showInputBox({
        prompt: "Qualified name (e.g. project.src.main.run)",
        placeHolder: "<project>.<path>.<name>",
      });
      if (!qualifiedName) return;

      try {
        const result = await client.callTool<{ snippet?: string; error?: string }>(
          "get_code_snippet",
          { project: proj.name, qualified_name: qualifiedName },
        );
        if (result.error) {
          vscode.window.showWarningMessage(result.error);
          return;
        }
        showOutput(result.snippet ?? "(empty)", "Code Snippet");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to get snippet: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    vscode.commands.registerCommand("codebase-memory.openGraphPanel", async (item?: { project?: { name: string } }) => {
      const projectName = item?.project?.name;
      openGraphPanel(projectName);
    }),
    vscode.commands.registerCommand("codebase-memory.openQueryEditor", openQueryEditor),

    vscode.commands.registerCommand("codebase-memory.createQueryFromCursor", () => {
      const word = getWordAtCursor();
      const initialQuery = word
        ? `MATCH (n)\nWHERE n.name CONTAINS "${word}"\nRETURN n.name, n.label, n.file_path\nLIMIT 50`
        : "";
      openQueryEditor(initialQuery);
    }),

    // --- Smart commands (auto-detect symbol under cursor) ---

    vscode.commands.registerCommand("codebase-memory.searchAtCursor", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const word = getWordAtCursor();
      if (!word) {
        vscode.window.showWarningMessage("Place cursor on a symbol or select text");
        return;
      }
      const label = await vscode.window.showInputBox({
        prompt: "Node label (optional: Function, Class, Method, etc.)",
      });
      try {
        const result = await client.callTool<{
          results: { id: number; name: string; label: string; file_path?: string }[];
          total: number;
        }>("search_graph", {
          project: proj.name,
          name_pattern: escapeRegex(word),
          ...(label ? { label } : {}),
          limit: 200,
        });
        const items = result.results ?? [];
        if (searchResultsProvider) {
          if (items.length === 0) {
            searchResultsProvider.clear();
          } else {
            searchResultsProvider.setResults(word, items, proj.root_path);
            vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
          }
        }
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No graph matches for "${word}" — falling back to text search`);
          fallbackTextSearch(word);
          return;
        }
        const lines = items.map((r) => `${r.name}  [${r.label}]  ${r.file_path ?? ""}`);
        showOutput(`${items.length} result(s)${result.total > items.length ? ` (showing ${items.length} of ${result.total})` : ""}\n\n${lines.join("\n")}`, "Search Graph");
      } catch (err) {
        vscode.window.showErrorMessage(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("codebase-memory.traceAtCursor", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const word = getWordAtCursor();
      if (!word) {
        vscode.window.showWarningMessage("Place cursor on a function name or select text");
        return;
      }
      const direction = await vscode.window.showQuickPick([
        { label: "Both (callers and callees)", value: "both" },
        { label: "Inbound (who calls this)", value: "inbound" },
        { label: "Outbound (what this calls)", value: "outbound" },
      ], { placeHolder: "Trace direction" });
      if (!direction) return;
      try {
        const result = await client.callTool<Record<string, unknown>>("trace_path", {
          project: proj.name,
          function_name: word,
          direction: direction.value,
          depth: 3,
        });

        const traceItems = extractTraceItems(result);
        if (traceItems.length > 0) {
          searchResultsProvider?.setResults(word, traceItems, proj.root_path);
          vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
        }

        showOutput(JSON.stringify(result, null, 2), "Trace Path");
      } catch (err) {
        vscode.window.showErrorMessage(`Trace failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("codebase-memory.snippetAtCursor", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const word = getWordAtCursor();
      if (!word) {
        vscode.window.showWarningMessage("Place cursor on a symbol name or select text");
        return;
      }
      try {
        const search = await client.callTool<{
          results: { id: number; name: string; label: string; file_path?: string }[];
          total: number;
        }>("search_graph", { project: proj.name, name_pattern: `.*${escapeRegex(word)}.*`, limit: 20 });

        const items = search.results ?? [];
        if (items.length === 0) {
          searchResultsProvider?.clear();
          vscode.window.showInformationMessage(`No graph matches for "${word}" — falling back to text search`);
          fallbackTextSearch(word);
          return;
        }

        let targetName = items[0].name;
        if (items.length > 1) {
          const pick = await vscode.window.showQuickPick(
            items.map((r) => ({
              label: r.name,
              description: `[${r.label}]`,
              detail: r.file_path ?? "",
              name: r.name,
            })),
            { placeHolder: `Pick a symbol for "${word}"` },
          );
          if (!pick) return;
          targetName = pick.name;
        }

        const result = await client.callTool<{ snippet?: string; error?: string }>(
          "get_code_snippet",
          { project: proj.name, qualified_name: targetName },
        );
        if (result.error) {
          vscode.window.showWarningMessage(result.error);
          return;
        }
        showOutput(result.snippet ?? "(empty)", "Code Snippet");
      } catch (err) {
        vscode.window.showErrorMessage(
          `Failed to get snippet: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

    // --- BM25 / Semantic / Code search at cursor ---

    vscode.commands.registerCommand("codebase-memory.bm25AtCursor", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const word = getWordAtCursor();
      if (!word) {
        vscode.window.showWarningMessage("Place cursor on text or select text");
        return;
      }
      try {
        const result = await client.callTool<SearchGraphResponse>("search_graph", {
          project: proj.name,
          query: word,
          limit: 200,
        });

        const items = result.results ?? [];
        if (searchResultsProvider) {
          if (items.length === 0) {
            searchResultsProvider.clear();
          } else {
            searchResultsProvider.setResults(word, items, proj.root_path);
            vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
          }
        }
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No BM25 matches for "${word}" — falling back to text search`);
          fallbackTextSearch(word);
          return;
        }
        const lines = items.map((r) => `${r.name}  [${r.label}]  ${r.file_path ?? ""}`);
        showOutput(`${items.length} BM25 result(s)\n\n${lines.join("\n")}`, "BM25 Search");
      } catch (err) {
        vscode.window.showErrorMessage(`BM25 search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("codebase-memory.semanticAtCursor", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const word = getWordAtCursor();
      if (!word) {
        vscode.window.showWarningMessage("Place cursor on text or select text");
        return;
      }
      try {
        const result = await client.callTool<SearchGraphResponse>("search_graph", {
          project: proj.name,
          semantic_query: [word],
          limit: 50,
        });

        const items = result.semantic_results ?? [];
        if (searchResultsProvider) {
          if (items.length === 0) {
            searchResultsProvider.clear();
          } else {
            searchResultsProvider.setResults(word, items, proj.root_path);
            vscode.commands.executeCommand("workbench.view.extension.codebase-memory");
          }
        }
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No semantic matches for "${word}"`);
          return;
        }
        const lines = items.map((r) => `${r.name}  [${r.label}]  (score: ${r.score?.toFixed(3) ?? "?"})  ${r.file_path ?? ""}`);
        showOutput(`${items.length} semantic result(s)\n\n${lines.join("\n")}`, "Semantic Search");
      } catch (err) {
        vscode.window.showErrorMessage(`Semantic search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    vscode.commands.registerCommand("codebase-memory.codeSearchAtCursor", async () => {
      const proj = await selectProject(client);
      if (!proj) return;

      const word = getWordAtCursor();
      if (!word) {
        vscode.window.showWarningMessage("Place cursor on text or select text");
        return;
      }
      try {
        const result = await client.callTool<{ results?: SearchCodeResult[]; total_grep_matches?: number; total_results?: number }>(
          "search_code",
          { project: proj.name, pattern: word, mode: "compact", limit: 20 },
        );

        const items = result.results ?? [];
        if (items.length === 0) {
          vscode.window.showInformationMessage(`No code matches for "${word}" — falling back to text search`);
          fallbackTextSearch(word);
          return;
        }

        const fileItems = items.map((r) => ({
          name: r.node ?? r.file ?? word,
          label: r.label ?? "Match",
          file_path: r.file,
          start_line: r.start_line,
        }));
        searchResultsProvider?.setResults(word, fileItems, proj.root_path);
        vscode.commands.executeCommand("workbench.view.extension.codebase-memory");

        const lines = items.map((r) => {
          const header = `${r.node ?? "(match)"}  [${r.label ?? "?"}]  ${r.file ?? ""}${r.start_line ? `:${r.start_line}` : ""}`;
          return header;
        });
        showOutput(`${items.length} result(s) (${result.total_grep_matches ?? "?"} raw grep matches)\n\n${lines.join("\n\n---\n\n")}`, "Code Search");
      } catch (err) {
        vscode.window.showErrorMessage(`Code search failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // --- Saved custom queries ---

    vscode.commands.registerCommand("codebase-memory.runSavedQuery", async () => {
      if (!client.ready) {
        vscode.window.showWarningMessage("Server not running. Start it first.");
        return;
      }

      const proj = await selectProject(client);
      if (!proj) return;

      const queries = vscode.workspace
        .getConfiguration("codebase-memory")
        .get<{ id: string; name: string; query: string; key: string }[]>("customQueries", []);
      if (queries.length === 0) {
        vscode.window.showInformationMessage("No saved queries. Use 'Codebase Memory: Open Query Editor' to create one.");
        return;
      }

      const word = getWordAtCursor();
      const pick = await vscode.window.showQuickPick(
        queries.map((q) => ({
          label: q.name,
          description: q.key ? `[${q.key}]` : "",
          detail: q.query.length > 80 ? q.query.slice(0, 80) + "..." : q.query,
          id: q.id,
          query: q.query,
        })),
        { placeHolder: "Select a saved query to run" },
      );
      if (!pick) return;

      let finalQuery = pick.query;
      if (word) {
        finalQuery = finalQuery.replace(/\{\{word\}\}/g, word);
      }
      finalQuery = finalQuery.replace(/\{\{project\}\}/g, proj.name);

      try {
        const result = await client.callTool("query_graph", { project: proj.name, query: finalQuery });
        showOutput(
          `Query: ${finalQuery}\n\n${JSON.stringify(result, null, 2)}`,
          `Custom Query: ${pick.label}`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `Query failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),

  );
}
