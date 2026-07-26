import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { emptyModelInfoState, MODEL_INFO_CHANNEL, REFRESH_CHANNEL, type ModelInfoState } from "./state.ts";

export function installModelInfo(pi: ExtensionAPI) {
  let state: ModelInfoState = emptyModelInfoState();
  let currentContext: ExtensionContext | undefined;
  const publish = () => pi.events.emit(MODEL_INFO_CHANNEL, { ...state });

  function refresh(ctx: ExtensionContext) {
    currentContext = ctx;
    const model = ctx.model;
    state = {
      provider: model?.provider ?? "",
      modelId: model?.id ?? "no-model",
      modelName: model?.name ?? model?.id ?? "No model",
      thinking: model?.reasoning ? pi.getThinkingLevel() : "off",
    };
    publish();
  }

  const stopRefreshListener = pi.events.on(REFRESH_CHANNEL, () => {
    if (currentContext) refresh(currentContext);
  });

  pi.on("session_start", (_event, ctx) => refresh(ctx));
  pi.on("model_select", (event, ctx) => {
    state = {
      provider: event.model.provider,
      modelId: event.model.id,
      modelName: event.model.name,
      thinking: event.model.reasoning ? pi.getThinkingLevel() : "off",
    };
    publish();
    refresh(ctx);
  });
  pi.on("thinking_level_select", (event) => {
    state = { ...state, thinking: event.level };
    publish();
  });
  pi.on("session_shutdown", () => {
    stopRefreshListener();
    currentContext = undefined;
  });
}
