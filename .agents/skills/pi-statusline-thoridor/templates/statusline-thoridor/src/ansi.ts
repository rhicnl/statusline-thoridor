import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function fg(hex: string, text: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

export function alignRightOnLine(left: string, right: string, width: number): string {
  const leftW = visibleWidth(left);
  const rightW = visibleWidth(right);
  if (!right) return truncateToWidth(left, width, "...");
  if (leftW + 1 + rightW <= width) return left + " ".repeat(width - leftW - rightW) + right;
  if (rightW >= width) return truncateToWidth(right, width, "");
  const clippedLeft = truncateToWidth(left, width - rightW - 1, "...");
  return clippedLeft + " ".repeat(Math.max(1, width - visibleWidth(clippedLeft) - rightW)) + right;
}

export function padFooterLine(line: string, width: number): string {
  // Do not prefix or right-pad footer rows. Even a one-cell left inset caused
  // this TUI/terminal layout to reserve a phantom row after settle.
  return truncateToWidth(line, Math.max(0, width - 1), "");
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}
