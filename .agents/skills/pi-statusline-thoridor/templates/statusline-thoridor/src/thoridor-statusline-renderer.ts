import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { alignRightOnLine, fg, fmtTokens, padFooterLine } from "./ansi.ts";
import { getMcpInfoState } from "./mcp-info.ts";
import type {
  GitInfoState,
  ModelInfoState,
  TokenInfoState,
} from "./state.ts";

// Thoridor: a three-row statusline whose context gauge runs an independently
// randomized thunder strike in every used cell while Pi is generating.
export const THORIDOR_ANIMATION_INTERVAL_MS = 120;
const SEPARATOR_COLOR = "#808080";
const DIM_COLOR = "#6e6e6e";
const BAR_WIDTH = 26;
const THUNDER_ICON = "\uf0e7";
const UNUSED_ICON = "·";
// Color profiles: "model"/"thinking" style row 1, "folder" styles row 2.
// Select via the THORIDOR_PROFILE env var; magni is the default.
const THORIDOR_PROFILES = {
  magni: { model: "#3333ff", thinking: "#0000ff", folder: "#ff0000" },
  "eli-magi": { model: "#ff0000", thinking: "#cc0000", folder: "#3333ff" },
} as const;
type ThoridorProfile =
  (typeof THORIDOR_PROFILES)[keyof typeof THORIDOR_PROFILES];

function resolveThoridorProfile(): ThoridorProfile {
  const name = (process.env.THORIDOR_PROFILE ?? "")
    .trim()
    .toLowerCase() as keyof typeof THORIDOR_PROFILES;
  return THORIDOR_PROFILES[name] ?? THORIDOR_PROFILES.magni;
}

const THORIDOR_CONTEXT_BAR_COLOR = "#ffff1a";
const THORIDOR_CONTEXT_TEXT_COLOR = "#b3b312";
const THUNDER_FLASH_COLOR = "#ffff66";
const DIR_ICON = "\uf07b";
const BRANCH_ICON = "\ue0a0";
const THUNDER_STRIKE_FRAMES = [
  { glyph: UNUSED_ICON, intensity: 0.25, flash: 0, emphasis: "dim" },
  { glyph: "ϟ", intensity: 0.7, flash: 0.45, emphasis: "normal" },
  { glyph: THUNDER_ICON, intensity: 1, flash: 1, emphasis: "bold" },
  { glyph: "ϟ", intensity: 0.7, flash: 0.45, emphasis: "normal" },
  { glyph: UNUSED_ICON, intensity: 0.25, flash: 0, emphasis: "dim" },
] as const;
const MIN_STRIKE_CYCLE_FRAMES = 9;
const STRIKE_CYCLE_VARIANCE = 9;
const MIN_STRIKE_SPEED_PERCENT = 30;
const STRIKE_SPEED_VARIANCE = 70;

function formatCwd(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const rel = relative(resolve(home), resolve(cwd));
  const inside =
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!inside) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

function mixHex(from: string, to: string, amount: number): string {
  const channel = (start: number, end: number) =>
    Math.round(start + (end - start) * amount)
      .toString(16)
      .padStart(2, "0");
  const fromRgb = [1, 3, 5].map((offset) =>
    parseInt(from.slice(offset, offset + 2), 16),
  );
  const toRgb = [1, 3, 5].map((offset) =>
    parseInt(to.slice(offset, offset + 2), 16),
  );
  return `#${channel(fromRgb[0] ?? 0, toRgb[0] ?? 0)}${channel(
    fromRgb[1] ?? 0,
    toRgb[1] ?? 0,
  )}${channel(fromRgb[2] ?? 0, toRgb[2] ?? 0)}`;
}

function createThunderProgressBar(
  percentage: number,
  fillColor: string,
  width = BAR_WIDTH,
): string {
  const filled = Math.min(Math.round((percentage / 100) * width), width);
  const empty = width - filled;
  return `${fg(fillColor, THUNDER_ICON.repeat(filled))}${fg(
    DIM_COLOR,
    UNUSED_ICON.repeat(empty),
  )}`;
}

function thunderHash(value: number): number {
  let hash = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function getThunderStrikeFrame(cellIndex: number, phase: number) {
  const cycleLength =
    MIN_STRIKE_CYCLE_FRAMES +
    (thunderHash(cellIndex + 1) % STRIKE_CYCLE_VARIANCE);
  const offset = thunderHash(cellIndex + 101) % cycleLength;
  const speedPercent =
    MIN_STRIKE_SPEED_PERCENT +
    (thunderHash(cellIndex + 211) % (STRIKE_SPEED_VARIANCE + 1));
  const cellPhase = Math.floor(phase * (speedPercent / 100));
  const cycleFrame = (cellPhase + offset) % cycleLength;
  return THUNDER_STRIKE_FRAMES[cycleFrame] ?? THUNDER_STRIKE_FRAMES[0];
}

function renderThunderStrikeCell(
  cellIndex: number,
  phase: number,
  fillColor: string,
): string {
  const frame = getThunderStrikeFrame(cellIndex, phase);
  const chargedColor = mixHex(DIM_COLOR, fillColor, frame.intensity);
  const strikeColor = mixHex(chargedColor, THUNDER_FLASH_COLOR, frame.flash);
  const emphasisStart =
    frame.emphasis === "bold"
      ? "\x1b[1m"
      : frame.emphasis === "dim"
        ? "\x1b[2m"
        : "";
  const emphasisEnd = emphasisStart ? "\x1b[22m" : "";
  return fg(strikeColor, `${emphasisStart}${frame.glyph}${emphasisEnd}`);
}

function createRandomThunderProgressBar(
  percentage: number,
  fillColor: string,
  phase: number,
  width = BAR_WIDTH,
): string {
  const filled = Math.min(Math.round((percentage / 100) * width), width);
  const empty = width - filled;
  const used = Array.from({ length: filled }, (_unused, cellIndex) =>
    renderThunderStrikeCell(cellIndex, phase, fillColor),
  ).join("");
  const unused = fg(DIM_COLOR, UNUSED_ICON.repeat(empty));
  return `${used}${unused}`;
}

function renderPr(gitInfo: GitInfoState): string {
  if (!gitInfo.pullRequest) return "";
  const label = `PR#${gitInfo.pullRequest.number}`;
  const linked = getCapabilities().hyperlinks
    ? hyperlink(label, gitInfo.pullRequest.url)
    : label;
  return gitInfo.pullRequest.isDraft ? `${linked} draft` : linked;
}

export function renderThoridorFooterRows(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  width: number,
  modelInfo: ModelInfoState,
  tokenInfo: TokenInfoState,
  gitInfo: GitInfoState,
): string[] {
  const profile = resolveThoridorProfile();
  const innerWidth = Math.max(0, width - 2);
  const contentWidth = Math.max(0, innerWidth - 1);
  const provider = modelInfo.provider;
  const modelStr = provider
    ? `${provider}/${modelInfo.modelId}`
    : modelInfo.modelId;
  const modelPart = fg(profile.model, modelStr);
  const animationPhase = tokenInfo.generating
    ? Math.floor(Date.now() / THORIDOR_ANIMATION_INTERVAL_MS)
    : 0;
  const modelStatusParts = [modelPart];
  if (modelInfo.thinking && modelInfo.thinking !== "off")
    modelStatusParts.push(fg(profile.thinking, modelInfo.thinking));

  const cwd = ctx.sessionManager.getCwd();
  const pwd = formatCwd(cwd, process.env.HOME || process.env.USERPROFILE);
  let row1 = ` ${modelStatusParts.join("  ")}`;
  const sessionName = ctx.sessionManager.getSessionName();
  if (sessionName) row1 += ` ${fg(SEPARATOR_COLOR, `[${sessionName}]`)}`;
  row1 = truncateToWidth(row1, contentWidth, "...");

  const dirPart = fg(profile.folder, `${DIR_ICON} \\${pwd}`);
  let locationPart = ` ${dirPart}`;
  if (gitInfo.isRepository && gitInfo.branch) {
    let gitPart = `${BRANCH_ICON} ${gitInfo.branch}`;
    if (gitInfo.changedFiles > 0)
      gitPart += ` · ${gitInfo.changedFiles} changed`;
    const pr = renderPr(gitInfo);
    if (pr) gitPart += ` · ${pr}`;
    locationPart += `${fg(SEPARATOR_COLOR, " · ")}${fg(profile.folder, gitPart)}`;
  }

  const mcpInfo = getMcpInfoState(footerData.getExtensionStatuses());
  const row2 = alignRightOnLine(
    locationPart,
    mcpInfo.status ? fg(profile.folder, mcpInfo.status) : "",
    contentWidth,
  );

  const pct =
    tokenInfo.contextPercent === null
      ? null
      : Math.round(tokenInfo.contextPercent);
  const barColor = THORIDOR_CONTEXT_BAR_COLOR;
  const progress = createThunderProgressBar(pct ?? 0, barColor);
  const pctDisplay = fg(
    THORIDOR_CONTEXT_TEXT_COLOR,
    pct !== null ? `${pct}%` : "?%",
  );
  const tokenDisplay =
    tokenInfo.contextTokens !== null
      ? fg(
          THORIDOR_CONTEXT_TEXT_COLOR,
          `(${fmtTokens(tokenInfo.contextTokens)}/${fmtTokens(tokenInfo.contextWindow)})`,
        )
      : fg(
          THORIDOR_CONTEXT_TEXT_COLOR,
          `(estimating/${fmtTokens(tokenInfo.contextWindow)})`,
        );

  const tokenSpeed =
    tokenInfo.tokensPerSecond !== null
      ? fg(
          THORIDOR_CONTEXT_TEXT_COLOR,
          `${Math.round(tokenInfo.tokensPerSecond)} tok/s`,
        )
      : "";
  const cost = fg(THORIDOR_CONTEXT_TEXT_COLOR, `$${tokenInfo.cost.toFixed(2)}`);

  const rightStatus = [tokenSpeed, cost]
    .filter(Boolean)
    .join(fg(THORIDOR_CONTEXT_TEXT_COLOR, " · "));
  const contextProgress = tokenInfo.generating
    ? createRandomThunderProgressBar(pct ?? 0, barColor, animationPhase)
    : progress;
  const row3 = alignRightOnLine(
    ` ${contextProgress} ${pctDisplay} ${tokenDisplay}`,
    rightStatus,
    contentWidth,
  );

  return [
    padFooterLine(row1, width),
    padFooterLine(row2, width),
    padFooterLine(row3, width),
  ];
}
