import * as vscode from "vscode";
import { McpClient } from "./mcpClient";

class McpLmTool implements vscode.LanguageModelTool<Record<string, unknown>> {
  constructor(
    private client: McpClient,
    private toolName: string,
  ) {}

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<Record<string, unknown>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const result = await this.client.callTool(this.toolName, options.input ?? {});
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Error: ${err instanceof Error ? err.message : String(err)}`),
      ]);
    }
  }
}

export function registerLmTools(ctx: vscode.ExtensionContext, client: McpClient): void {
  const tools: { id: string; mcpName: string }[] = [
    { id: "codebase-memory_search-graph", mcpName: "search_graph" },
    { id: "codebase-memory_trace-path", mcpName: "trace_path" },
    { id: "codebase-memory_get-code-snippet", mcpName: "get_code_snippet" },
    { id: "codebase-memory_query-graph", mcpName: "query_graph" },
    { id: "codebase-memory_search-code", mcpName: "search_code" },
    { id: "codebase-memory_get-architecture", mcpName: "get_architecture" },
    { id: "codebase-memory_list-projects", mcpName: "list_projects" },
    { id: "codebase-memory_detect-changes", mcpName: "detect_changes" },
  ];

  for (const tool of tools) {
    try {
      const disposable = vscode.lm.registerTool(tool.id, new McpLmTool(client, tool.mcpName));
      ctx.subscriptions.push(disposable);
    } catch (err) {
      console.error(`[cbm] Failed to register LM tool ${tool.id}:`, err);
    }
  }
}
