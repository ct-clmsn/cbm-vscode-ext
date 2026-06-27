import * as vscode from "vscode";

const MAX_LINES = 2000;
const MAX_RESULTS = 500;

const FILE_LINE_RE = /(?:^|\s)((?:\/(?:[^\s/]+\/)*[^\s/]+\.\w+)|(?:[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s\\]+\.\w+))(?:[:#](\d+))?(?:\s|$)/g;

function parseFileLineReferences(text: string): { filePath: string; line: number | undefined }[] {
  const results: { filePath: string; line: number | undefined }[] = [];
  FILE_LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_LINE_RE.exec(text)) !== null) {
    results.push({ filePath: match[1]!, line: match[2] ? Number(match[2]) : undefined });
  }
  return results;
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractFileRefs(obj: unknown, depth = 0): { filePath: string; line: number | undefined }[] {
  if (!obj || typeof obj !== "object" || depth > 8) return [];
  const results: { filePath: string; line: number | undefined }[] = [];
  const record = obj as Record<string, unknown>;

  const filePath =
    (record.file_path as string | undefined) ??
    (record.file as string | undefined) ??
    (record.path as string | undefined);
  if (typeof filePath === "string" && filePath.length > 0) {
    const line =
      (record.start_line as number | undefined) ??
      (record.line as number | undefined) ??
      (record.lineno as number | undefined);
    results.push({ filePath, line });
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      results.push(...extractFileRefs(item, depth + 1));
    }
  } else {
    for (const val of Object.values(record)) {
      results.push(...extractFileRefs(val, depth + 1));
    }
  }

  return results;
}

// --- Output line tree item ---

export class OutputLineItem extends vscode.TreeItem {
  constructor(
    public readonly index: number,
    public readonly source: "stdout" | "stderr",
    public readonly lineText: string,
  ) {
    super(`[${source}] ${lineText}`, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${source.toUpperCase()}  ${lineText}`;
    this.contextValue = source === "stderr" ? "outputStderr" : "outputStdout";
    this.iconPath = new vscode.ThemeIcon(source === "stderr" ? "warning" : "output");
  }
}

// --- Result tree item ---

export class OutputResultItem extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly line: number | undefined,
    public readonly source: string,
  ) {
    const label = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
    const desc = line ? `${filePath}:${line}` : filePath;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = desc;
    this.tooltip = `${filePath}${line ? `:${line}` : ""}\n(from: ${source})`;
    this.iconPath = new vscode.ThemeIcon("go-to-file");
    this.contextValue = "outputResult";
    this.command = {
      command: "codebase-memory.openOutputResult",
      title: "Open File",
      arguments: [filePath, line],
    };
  }
}

// --- Live Output Provider ---

export class LiveOutputProvider implements vscode.TreeDataProvider<OutputLineItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OutputLineItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private lines: OutputLineItem[] = [];
  private batched = false;
  private nextIndex = 0;

  append(source: "stdout" | "stderr", text: string): void {
    for (const raw of text.split("\n")) {
      const line = raw.trimEnd();
      if (!line) continue;
      this.lines.push(new OutputLineItem(this.nextIndex++, source, line));
    }
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
    }
    this.scheduleRefresh();
  }

  clear(): void {
    this.lines = [];
    this.nextIndex = 0;
    this._onDidChangeTreeData.fire();
  }

  private scheduleRefresh(): void {
    if (this.batched) return;
    this.batched = true;
    setTimeout(() => {
      this.batched = false;
      this._onDidChangeTreeData.fire();
    }, 100);
  }

  getTreeItem(element: OutputLineItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<OutputLineItem[]> {
    return this.lines;
  }
}

// --- Live Result Provider ---

export class LiveResultProvider implements vscode.TreeDataProvider<OutputResultItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<OutputResultItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items: OutputResultItem[] = [];
  private seen = new Set<string>();

  ingestOutput(source: "stdout" | "stderr", line: string): void {
    const refs = parseFileLineReferences(line);
    for (const ref of refs) {
      this.addResult(ref, source);
    }
  }

  ingestToolResult(toolName: string, rawText: string): void {
    const parsed = tryParseJson(rawText);
    if (parsed) {
      const refs = extractFileRefs(parsed);
      for (const ref of refs) {
        this.addResult(ref, toolName);
      }
    }
    const textRefs = parseFileLineReferences(rawText);
    for (const ref of textRefs) {
      if (!refs.some((r) => r.filePath === ref.filePath && r.line === ref.line)) {
        this.addResult(ref, toolName);
      }
    }
  }

  private addResult(ref: { filePath: string; line: number | undefined }, source: string): void {
    const key = `${ref.filePath}:${ref.line ?? ""}:${source}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push(new OutputResultItem(ref.filePath, ref.line, source));
    if (this.items.length > MAX_RESULTS) {
      const removed = this.items.shift();
      if (removed) {
        this.seen.delete(`${removed.filePath}:${removed.line ?? ""}:${removed.source}`);
      }
    }
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.items = [];
    this.seen.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: OutputResultItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<OutputResultItem[]> {
    return this.items;
  }
}
