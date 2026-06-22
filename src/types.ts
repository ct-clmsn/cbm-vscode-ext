export interface McpToolResult<T = unknown> {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface Project {
  name: string;
  root_path: string;
  indexed_at: string;
}

export interface SchemaInfo {
  node_labels: { label: string; count: number }[];
  edge_types: { type: string; count: number }[];
  total_nodes: number;
  total_edges: number;
}

export interface GraphNode {
  id: number;
  x: number;
  y: number;
  z: number;
  label: string;
  name: string;
  file_path?: string;
  size: number;
  color: string;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  linked_projects?: {
    project: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
    offset: { x: number; y: number; z: number };
    cross_edges: GraphEdge[];
  }[];
}

export interface ArchitectureInfo {
  languages: { language: string; percentage: number }[];
  packages: string[];
  entry_points: string[];
  routes: { method: string; path: string; handler: string }[];
  hotspots: { name: string; score: number }[];
  boundaries: { type: string; name: string; members: string[] }[];
  layers?: { name: string; modules: string[] }[];
  clusters?: { id: number; members: string[] }[];
  adr?: { has_adr: boolean; content?: string; updated_at?: string };
}

export interface ChangeInfo {
  files: { path: string; status: string }[];
  affected_symbols: { name: string; risk: "high" | "medium" | "low" }[];
  summary: string;
}

export interface SearchGraphResult {
  id?: number;
  name: string;
  label: string;
  file_path?: string;
  qualified_name?: string;
  start_line?: number;
  end_line?: number;
}

export interface SearchGraphResponse {
  results: SearchGraphResult[];
  semantic_results?: (SearchGraphResult & { score: number })[];
  total: number;
  search_mode?: string;
}

export interface SearchCodeResult {
  node?: string;
  qualified_name?: string;
  label?: string;
  file?: string;
  start_line?: number;
  end_line?: number;
  in_degree?: number;
  out_degree?: number;
  match_lines?: number[];
  source?: string;
  context?: string;
  context_start?: number;
}

export interface ServerStatus {
  running: boolean;
  binaryPath?: string;
  pid?: number;
}
