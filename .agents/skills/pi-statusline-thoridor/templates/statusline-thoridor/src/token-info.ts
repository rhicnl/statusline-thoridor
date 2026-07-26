import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emptyTokenInfoState, REFRESH_CHANNEL, TOKEN_INFO_CHANNEL, type TokenInfoState } from "./state.ts";

const CHARS_PER_ESTIMATED_TOKEN = 4;
const LIVE_UPDATE_INTERVAL_MS = 200;

function estimateContentTokens(characters: number) {
  return Math.ceil(characters / CHARS_PER_ESTIMATED_TOKEN);
}

function getSessionCost(ctx: ExtensionContext) {
  let cost = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      cost += (entry.message as AssistantMessage).usage.cost.total;
    }
  }
  return cost;
}

export function installTokenInfo(pi: ExtensionAPI) {
  let state: TokenInfoState = emptyTokenInfoState();
  let currentContext: ExtensionContext | undefined;
  let contentStreamStart: number | null = null;
  let lastContentDeltaAt: number | null = null;
  let contentCharacters = 0;
  let firstContentDeltaCharacters = 0;
  let contentDeltaCount = 0;
  let sawToolCall = false;
  let runContentTokens = 0;
  let runContentStreamMs = 0;
  let lastLiveUpdate = 0;

  const publish = () => pi.events.emit(TOKEN_INFO_CHANNEL, { ...state });

  function refresh(ctx: ExtensionContext) {
    currentContext = ctx;
    const usage = ctx.getContextUsage();
    state = {
      ...state,
      contextTokens: usage?.tokens ?? 0,
      contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
      contextPercent: usage?.percent ?? 0,
      cost: getSessionCost(ctx),
    };
    publish();
  }

  function resetMessageTracking() {
    contentStreamStart = null;
    lastContentDeltaAt = null;
    contentCharacters = 0;
    firstContentDeltaCharacters = 0;
    contentDeltaCount = 0;
    sawToolCall = false;
    lastLiveUpdate = 0;
  }

  const stopRefreshListener = pi.events.on(REFRESH_CHANNEL, () => {
    if (currentContext) refresh(currentContext);
  });

  pi.on("session_start", (_event, ctx) => {
    resetMessageTracking();
    runContentTokens = 0;
    runContentStreamMs = 0;
    state = { ...state, tokensPerSecond: null, generating: false };
    refresh(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    runContentTokens = 0;
    runContentStreamMs = 0;
    resetMessageTracking();
    state = { ...state, tokensPerSecond: null, generating: true };
    refresh(ctx);
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") resetMessageTracking();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "toolcall_delta") {
      sawToolCall = true;
      return;
    }
    if (streamEvent.type !== "text_delta" && streamEvent.type !== "thinking_delta") return;
    if (!streamEvent.delta) return;

    const now = Date.now();
    if (contentStreamStart === null) {
      contentStreamStart = now;
      firstContentDeltaCharacters = streamEvent.delta.length;
    }
    lastContentDeltaAt = now;
    contentCharacters += streamEvent.delta.length;
    contentDeltaCount += 1;

    const elapsedMs = now - contentStreamStart;
    const streamedCharacters = contentCharacters - firstContentDeltaCharacters;
    if (contentDeltaCount < 2 || elapsedMs <= 0 || streamedCharacters <= 0 || now - lastLiveUpdate < LIVE_UPDATE_INTERVAL_MS) return;
    lastLiveUpdate = now;
    state = { ...state, tokensPerSecond: estimateContentTokens(streamedCharacters) / (elapsedMs / 1000) };
    publish();
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    sawToolCall ||= event.message.content.some((block) => block.type === "toolCall");
    if (contentStreamStart !== null && contentCharacters > 0) {
      const streamEnd = lastContentDeltaAt ?? contentStreamStart;
      const streamMs = streamEnd - contentStreamStart;
      const estimatedFirstDeltaTokens = estimateContentTokens(firstContentDeltaCharacters);
      const streamedTokens = !sawToolCall && event.message.usage.output > 0
        ? Math.max(0, event.message.usage.output - estimatedFirstDeltaTokens)
        : Math.max(0, estimateContentTokens(contentCharacters) - estimatedFirstDeltaTokens);
      if (contentDeltaCount >= 2 && streamMs >= 50 && streamedTokens > 0) {
        runContentTokens += streamedTokens;
        runContentStreamMs += streamMs;
        state = { ...state, tokensPerSecond: runContentTokens / (runContentStreamMs / 1000) };
      }
    }
    resetMessageTracking();
    refresh(ctx);
  });

  pi.on("turn_end", (_event, ctx) => refresh(ctx));
  pi.on("agent_settled", (_event, ctx) => {
    state = { ...state, generating: false };
    refresh(ctx);
  });
  pi.on("session_shutdown", () => {
    stopRefreshListener();
    currentContext = undefined;
  });
}
