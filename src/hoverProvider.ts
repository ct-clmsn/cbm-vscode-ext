import * as vscode from "vscode";
import { McpClient } from "./mcpClient";

export function registerHoverProvider(ctx: vscode.ExtensionContext, client: McpClient): void {
  const provider = vscode.languages.registerHoverProvider(
    { scheme: "file" },
    {
      async provideHover(document, position) {
        if (!client.ready) return;

        const wordRange = document.getWordRangeAtPosition(position, /[\w.]+/);
        if (!wordRange) return;

        const word = document.getText(wordRange);
        if (!word || word.length < 2) return;

        const projectUri = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!projectUri) return;
        const project = projectUri.name;

        try {
          const result = await client.callTool<{
            results: { name: string; label: string; file_path?: string }[];
            total: number;
          }>("search_graph", {
            project,
            name_pattern: `.*${escapeRegex(word)}.*`,
            limit: 5,
          });

          const items = result.results ?? [];
          if (items.length === 0) return;

          const markdown = new vscode.MarkdownString(
            "**Codebase Memory**\n\n" +
              items
                .map(
                  (r) =>
                    `- \`${r.name}\` _[${r.label}]_${
                      r.file_path ? ` — ${r.file_path}` : ""
                    }`,
                )
                .join("\n") +
              (result.total > items.length
                ? `\n\n_…and ${result.total - items.length} more_`
                : ""),
          );
          markdown.isTrusted = true;

          return new vscode.Hover(markdown, wordRange);
        } catch {
          return;
        }
      },
    },
  );

  ctx.subscriptions.push(provider);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
