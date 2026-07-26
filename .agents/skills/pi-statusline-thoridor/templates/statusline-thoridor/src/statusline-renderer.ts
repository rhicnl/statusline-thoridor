import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from "@earendil-works/pi-coding-agent";
import {
  emptyGitInfoState,
  emptyModelInfoState,
  emptyTokenInfoState,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
  TOKEN_INFO_CHANNEL,
  type GitInfoState,
  type ModelInfoState,
  type TokenInfoState,
} from "./state.ts";
import {
  isThoridorOff,
  renderThoridorFooterRows,
  THORIDOR_ANIMATION_INTERVAL_MS,
} from "./thoridor-statusline-renderer.ts";

type StatuslineRenderer = (
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  width: number,
  modelInfo: ModelInfoState,
  tokenInfo: TokenInfoState,
  gitInfo: GitInfoState,
) => string[];

const renderStatusline: StatuslineRenderer = renderThoridorFooterRows;

export function installStatuslineRenderer(pi: ExtensionAPI) {
  let modelInfo = emptyModelInfoState();
  let tokenInfo = emptyTokenInfoState();
  let gitInfo = emptyGitInfoState();
  let requestRender: (() => void) | undefined;
  let animationTimer: ReturnType<typeof setInterval> | undefined;

  function stopAnimationTimer() {
    if (animationTimer) clearInterval(animationTimer);
    animationTimer = undefined;
  }

  function syncAnimationTimer() {
    if (!tokenInfo.generating) {
      stopAnimationTimer();
      return;
    }
    if (animationTimer) return;
    animationTimer = setInterval(
      () => requestRender?.(),
      THORIDOR_ANIMATION_INTERVAL_MS,
    );
    animationTimer.unref();
  }

  const stopModel = pi.events.on(MODEL_INFO_CHANNEL, (value) => {
    modelInfo = value as ModelInfoState;
    requestRender?.();
  });

  const stopToken = pi.events.on(TOKEN_INFO_CHANNEL, (value) => {
    tokenInfo = value as TokenInfoState;
    syncAnimationTimer();
    requestRender?.();
  });

  const stopGit = pi.events.on(GIT_INFO_CHANNEL, (value) => {
    gitInfo = value as GitInfoState;
    requestRender?.();
  });

  function apply(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    if (isThoridorOff()) {
      // THORIDOR_PROFILE=off: leave Pi's stock footer and working row alone.
      stopAnimationTimer();
      ctx.ui.setFooter(undefined);
      ctx.ui.setWorkingVisible(true);
      ctx.ui.setStatus("statusline-thoridor", undefined);
      return;
    }
    stopAnimationTimer();
    syncAnimationTimer();

    // Thoridor owns the working affordance, so Pi's separate working row is
    // hidden to avoid leaving an empty terminal line after a turn settles.
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      tui.setClearOnShrink(true);
      requestRender = () => tui.requestRender();
      const unsub = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsub,
        invalidate() {},
        render(width: number) {
          return renderStatusline(
            ctx,
            footerData,
            width,
            modelInfo,
            tokenInfo,
            gitInfo,
          );
        },
      };
    });
    ctx.ui.setStatus("statusline-thoridor", undefined);
    pi.events.emit(REFRESH_CHANNEL, undefined);
  }

  pi.registerCommand("thoridor-statusline", {
    description: "Refresh the Thoridor three-row thunder statusline",
    handler: async (_args, ctx) => {
      apply(ctx);
      ctx.ui.notify("Thoridor statusline refreshed", "info");
    },
  });

  pi.on("session_start", (_event, ctx) => apply(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    stopModel();
    stopToken();
    stopGit();
    stopAnimationTimer();
    requestRender = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setFooter(undefined);
      ctx.ui.setWorkingVisible(true);
    }
  });
}
