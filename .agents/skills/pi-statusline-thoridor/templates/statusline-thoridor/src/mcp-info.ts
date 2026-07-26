export interface McpInfoState {
  status: string | null;
  extraStatuses: string[];
}

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

function normalizeStatusText(text: string): string {
  return text.replace(ANSI_PATTERN, "").replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function formatMcpStatus(text: string): string | null {
  const normalized = normalizeStatusText(text);
  const match = normalized.match(/^MCP:\s*(\d+\/\d+)\s+servers\b/i);
  return match ? `MCP ${match[1]}` : null;
}

function isMcpStatus(key: string, text: string): boolean {
  return key.toLowerCase() === "mcp" || formatMcpStatus(text) !== null;
}

export function getMcpInfoState(statuses: ReadonlyMap<string, string>): McpInfoState {
  let status: string | null = null;
  const extraStatuses: string[] = [];

  for (const [key, text] of statuses.entries()) {
    if (isMcpStatus(key, text)) {
      if (!status) {
        status = key.toLowerCase() === "mcp"
          ? formatMcpStatus(text) ?? normalizeStatusText(text).replace(/^MCP:\s*/i, "MCP ").replace(/\s+servers\b/i, "")
          : formatMcpStatus(text);
      }
      continue;
    }
    extraStatuses.push(normalizeStatusText(text));
  }

  return { status, extraStatuses };
}
