import { spawn, type ChildProcess } from "child_process";
import type { McpToolResult } from "./types";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  toolName?: string;
}

export type OutputCallback = (source: "stdout" | "stderr", line: string) => void;
export type ToolResultCallback = (toolName: string, rawText: string) => void;

export class McpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private _ready = false;
  private log: (msg: string) => void;
  private _onOutput: OutputCallback[] = [];
  private _onToolResult: ToolResultCallback[] = [];

  constructor(logger?: (msg: string) => void) {
    this.log = logger ?? ((msg: string) => console.log(`[cbm] ${msg}`));
  }

  onOutput(cb: OutputCallback): void {
    this._onOutput.push(cb);
  }

  onToolResult(cb: ToolResultCallback): void {
    this._onToolResult.push(cb);
  }

  private emitOutput(source: "stdout" | "stderr", line: string): void {
    for (const cb of this._onOutput) {
      try { cb(source, line); } catch { /* ignore */ }
    }
  }

  private emitToolResult(toolName: string, rawText: string): void {
    for (const cb of this._onToolResult) {
      try { cb(toolName, rawText); } catch { /* ignore */ }
    }
  }

  get ready(): boolean {
    return this._ready;
  }

  async start(binaryPath: string, args: string[] = []): Promise<void> {
    if (this.process) {
      await this.stop();
    }

    return new Promise<void>((resolve, reject) => {
      try {
        const proc = spawn(binaryPath, args, {
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.process = proc;

        proc.stdout!.on("data", (data: Buffer) => {
          const chunk = data.toString();
          this.buffer += chunk;
          this.processBuffer();
          for (const line of chunk.split("\n").filter(Boolean)) {
            this.emitOutput("stdout", line.trim());
          }
        });

        proc.stderr!.on("data", (data: Buffer) => {
          for (const line of data.toString().split("\n").filter(Boolean)) {
            const trimmed = line.trim();
            this.log(trimmed);
            this.emitOutput("stderr", trimmed);
          }
        });

        proc.on("error", (err) => {
          this.log(`Process error: ${err.message} (code: ${(err as NodeJS.ErrnoException).code})`);
          this._ready = false;
          if (!this.process) return;
          reject(new Error(err.message));
          this.cleanup();
        });

        proc.on("exit", (code, signal) => {
          this.log(`Process exited: code=${code} signal=${signal}`);
          this._ready = false;
          this.cleanup();
        });

        this.initialize().then(() => {
          this._ready = true;
          resolve();
        }).catch(reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    this._ready = false;
    this.cleanup();
    this.process.kill("SIGTERM");
    this.process = null;
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!this._ready || !this.process) {
      throw new Error("Server not running");
    }

    const id = this.nextId++;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tool call "${name}" timed out (30s)`));
      }, 30000);

      this.pending.set(id, { resolve, reject, timer, toolName: name });

      try {
        this.process!.stdin!.write(request + "\n");
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]> {
    if (!this._ready || !this.process) {
      throw new Error("Server not running");
    }

    const id = this.nextId++;
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/list",
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Listing tools timed out"));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.process!.stdin!.write(request + "\n");
    });
  }

  private initialize(): Promise<void> {
    const id = this.nextId++;
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "vscode-codebase-memory", version: "0.1.0" },
      },
    });

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Initialization timed out"));
      }, 10000);
      this.pending.set(id, {
        resolve: () => {
          this.sendNotification("notifications/initialized");
          resolve();
        },
        reject,
        timer,
      });
      this.process!.stdin!.write(initReq + "\n");
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process) return;
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });
    this.process.stdin!.write(msg + "\n");
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        this.handleMessage(msg);
      } catch {
        this.log(`Non-JSON line from server (skipped): ${trimmed.slice(0, 120)}`);
      }
    }
  }

  private handleMessage(msg: {
    id?: number;
    result?: { content?: { type: string; text: string }[] };
    error?: { code: number; message: string };
    method?: string;
    params?: { name?: string };
  }): void {
    if (msg.method === "tools/call" && msg.params?.name) {
      return;
    }
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          const result = msg.result;
          const text = result?.content?.[0]?.text;
          if (text !== undefined) {
            this.emitToolResult(pending.toolName ?? "(unknown)", text);
            try {
              pending.resolve(JSON.parse(text));
            } catch {
              pending.resolve(text);
            }
          } else {
            pending.resolve(result);
          }
        }
      }
    }
  }

  private cleanup(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Server disconnected"));
    }
    this.pending.clear();
  }
}
