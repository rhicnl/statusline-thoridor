export const MODEL_INFO_CHANNEL = "statusline-thoridor:model-info";
export const TOKEN_INFO_CHANNEL = "statusline-thoridor:token-info";
export const GIT_INFO_CHANNEL = "statusline-thoridor:git-info";
export const REFRESH_CHANNEL = "statusline-thoridor:refresh";

export interface ModelInfoState {
  provider: string;
  modelId: string;
  modelName: string;
  thinking: string;
}

export interface TokenInfoState {
  contextTokens: number | null;
  contextWindow: number;
  contextPercent: number | null;
  cost: number;
  tokensPerSecond: number | null;
  generating: boolean;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitInfoState {
  isRepository: boolean;
  branch: string | null;
  changedFiles: number;
  pullRequest: PullRequestInfo | null;
}

export function emptyModelInfoState(): ModelInfoState {
  return { provider: "", modelId: "no-model", modelName: "No model", thinking: "off" };
}

export function emptyTokenInfoState(): TokenInfoState {
  return {
    contextTokens: 0,
    contextWindow: 0,
    contextPercent: 0,
    cost: 0,
    tokensPerSecond: null,
    generating: false,
  };
}

export function emptyGitInfoState(): GitInfoState {
  return { isRepository: false, branch: null, changedFiles: 0, pullRequest: null };
}
