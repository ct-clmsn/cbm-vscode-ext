import * as vscode from "vscode";
import { McpClient } from "./mcpClient";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function registerGraphSearchProvider(ctx: vscode.ExtensionContext, client: McpClient): void {
  const provider = vscode.workspace.registerTextSearchProvider("codebase-memory", {
    async provideTextSearchResults(
      query: vscode.TextSearchQuery,
      _options: vscode.TextSearchOptions,
      progress: vscode.Progress<vscode.TextSearchResult>,
      _token: vscode.CancellationToken,
    ) {
      if (!client.ready || !query.pattern) return { limitHit: false };

      try {
        const project = vscode.workspace.workspaceFolders?.[0]?.name ?? "";
        const result = await client.callTool<{
          results: { id: number; name: string; label: string; file_path?: string }[];
          total: number;
        }>("search_graph", {
          project,
          name_pattern: `.*${escapeRegex(query.pattern)}.*`,
          limit: 200,
        });

        for (const r of result.results ?? []) {
          if (_token.isCancellationRequested) break;
          const uri = r.file_path
            ? vscode.Uri.file(r.file_path)
            : vscode.Uri.parse(`codebase-memory://symbol/${r.name}`);
          progress.report({
            uri,
            range: new vscode.Range(0, 0, 0, 0),
            preview: { text: `[${r.label}] ${r.name}`, match: new vscode.Range(0, 0, 0, 0) },
          });
        }

        return { limitHit: result.total > 200 };
      } catch {
        return { limitHit: false };
      }
    },
  });

  ctx.subscriptions.push(provider);
}
