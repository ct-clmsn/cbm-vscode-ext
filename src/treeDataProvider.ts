import * as vscode from "vscode";
import type { Project, SchemaInfo } from "./types";
import { McpClient } from "./mcpClient";

export class SearchResultItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly tooltipText: string,
    public readonly filePath?: string,
    public readonly line?: number,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltipText;
    this.iconPath = new vscode.ThemeIcon("symbol-misc");
    this.contextValue = "searchResult";
    if (filePath) {
      this.command = {
        command: "codebase-memory.openSearchResult",
        title: "Open File",
        arguments: [filePath, line ?? 1],
      };
    }
  }
}

export class SearchResultsProvider implements vscode.TreeDataProvider<SearchResultItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SearchResultItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: SearchResultItem[] = [];
  private _query = "";
  private _projectRoot = "";

  get query(): string {
    return this._query;
  }

  clear(): void {
    this.items = [];
    this._query = "";
    this._onDidChangeTreeData.fire();
  }

  setResults(
    query: string,
    results: { name: string; label: string; file_path?: string; start_line?: number }[],
    projectRoot?: string,
  ): void {
    this._query = query;
    if (projectRoot) {
      this._projectRoot = projectRoot.replace(/\\/g, "/");
    }
    this.items = results.map((r) => {
      let label = r.name;
      let desc = `[${r.label}]`;
      let absPath = r.file_path;
      if (absPath) {
        const normalized = absPath.replace(/\\/g, "/");
        if (!normalized.startsWith("/") && !normalized.match(/^[A-Za-z]:/) && projectRoot) {
          absPath = projectRoot.replace(/\\/g, "/").replace(/\/$/, "") + "/" + normalized;
        }
        const parts = normalized.split("/");
        desc += ` ${parts.slice(-3).join("/")}`;
        if (r.start_line) {
          desc += `:${r.start_line}`;
        }
      }
      const loc = absPath && r.start_line ? `${absPath}:${r.start_line}` : absPath ?? "";
      return new SearchResultItem(label, desc, `[${r.label}] ${r.name}\n${loc}`, absPath, r.start_line);
    });
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SearchResultItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<SearchResultItem[]> {
    return this.items;
  }
}

export class ProjectTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly project?: Project,
    public readonly schema?: SchemaInfo,
    public readonly isAddAction?: boolean,
  ) {
    super(label, collapsibleState);

    if (isAddAction) {
      this.contextValue = "addProject";
      this.iconPath = new vscode.ThemeIcon("plus");
      this.command = {
        command: "codebase-memory.indexRepository",
        title: "Index Repository",
      };
      return;
    }

    this.contextValue = "project";
    this.tooltip = `${project?.root_path ?? ""}\nIndexed: ${project?.indexed_at ?? "unknown"}`;
    this.description = project?.root_path;

    if (schema) {
      const nodeCount = schema.node_labels.reduce((s, l) => s + l.count, 0);
      const edgeCount = schema.edge_types.reduce((s, t) => s + t.count, 0);
      this.tooltip += `\n${nodeCount.toLocaleString()} nodes, ${edgeCount.toLocaleString()} edges`;
    }

    this.iconPath = new vscode.ThemeIcon("database");
  }
}

export class ProjectsTreeDataProvider implements vscode.TreeDataProvider<ProjectTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ProjectTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: Project[] = [];
  private schemas = new Map<string, SchemaInfo>();

  constructor(private client: McpClient) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async loadProjects(): Promise<void> {
    try {
      const result = await this.client.callTool<{ projects: Project[] }>("list_projects");
      this.projects = result.projects ?? [];
      this.schemas.clear();
      for (const p of this.projects) {
        try {
          const schema = await this.client.callTool<SchemaInfo>("get_graph_schema", {
            project: p.name,
          });
          this.schemas.set(p.name, schema);
        } catch {
          this.schemas.set(p.name, {
            node_labels: [],
            edge_types: [],
            total_nodes: 0,
            total_edges: 0,
          });
        }
      }
    } catch {
      this.projects = [];
    }
    this.refresh();
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: ProjectTreeItem): vscode.ProviderResult<ProjectTreeItem[]> {
    if (_element) {
      return [];
    }

    const items: ProjectTreeItem[] = [];

    for (const p of this.projects) {
      const schema = this.schemas.get(p.name);
      items.push(
        new ProjectTreeItem(
          p.name,
          vscode.TreeItemCollapsibleState.None,
          p,
          schema,
        ),
      );
    }

    items.push(
      new ProjectTreeItem(
        "Index a repository...",
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        true,
      ),
    );

    return items;
  }
}
