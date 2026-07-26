import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { emptyGitInfoState, GIT_INFO_CHANNEL, REFRESH_CHANNEL, type GitInfoState, type PullRequestInfo } from "./state.ts";

const POLL_INTERVAL_MS = 3_000;
const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 10_000;

type CommandResult = { code: number; stdout: string; stderr: string };

function runCommand(command: string, args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, { cwd, env: process.env });
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => !settled && child.kill("SIGKILL"), 500).unref?.();
    }, timeoutMs);
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    };
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (err) => {
      stderr += err.message;
      finish(1);
    });
  });
}

function countChangedFiles(status: string) {
  if (!status.trim()) return 0;
  return status.split("\n").filter(Boolean).length;
}

function parsePullRequest(value: unknown): PullRequestInfo | null {
  if (typeof value !== "object" || value === null) return null;
  if (!("number" in value) || typeof value.number !== "number") return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  if (!("state" in value) || value.state !== "OPEN") return null;
  return { number: value.number, url: value.url, isDraft: "isDraft" in value && value.isDraft === true };
}

function parsePullRequestJson(value: string) {
  try {
    return parsePullRequest(JSON.parse(value));
  } catch {
    return null;
  }
}

export function installGitInfo(pi: ExtensionAPI) {
  let state: GitInfoState = emptyGitInfoState();
  let currentContext: ExtensionContext | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshRunning = false;
  let refreshQueued = false;
  let queriedPrBranch: string | null = null;
  let generation = 0;

  const publish = () => pi.events.emit(GIT_INFO_CHANNEL, { ...state });

  async function lookupPullRequest(ctx: ExtensionContext, branch: string) {
    const result = await runCommand("gh", ["pr", "view", branch, "--json", "number,url,state,isDraft"], ctx.cwd, GH_TIMEOUT_MS);
    if (result.code !== 0) return null;
    return parsePullRequestJson(result.stdout);
  }

  async function doRefresh(ctx: ExtensionContext, forcePullRequest: boolean, refreshGeneration: number) {
    if (refreshGeneration !== generation) return;
    currentContext = ctx;

    const repo = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], ctx.cwd, GIT_TIMEOUT_MS);
    if (refreshGeneration !== generation) return;
    if (repo.code !== 0 || repo.stdout !== "true") {
      queriedPrBranch = null;
      state = emptyGitInfoState();
      publish();
      return;
    }

    const [branchResult, headResult, statusResult] = await Promise.all([
      runCommand("git", ["branch", "--show-current"], ctx.cwd, GIT_TIMEOUT_MS),
      runCommand("git", ["rev-parse", "--short", "HEAD"], ctx.cwd, GIT_TIMEOUT_MS),
      runCommand("git", ["status", "--porcelain=v1", "--untracked-files=all"], ctx.cwd, GIT_TIMEOUT_MS),
    ]);
    if (refreshGeneration !== generation) return;

    const branchName = branchResult.stdout.trim();
    const shortHead = headResult.stdout.trim();
    const branch = branchName || (shortHead ? `detached@${shortHead}` : "detached");
    const branchChanged = branchName !== queriedPrBranch;

    state = {
      isRepository: true,
      branch,
      changedFiles: statusResult.code === 0 ? countChangedFiles(statusResult.stdout) : 0,
      pullRequest: branchChanged ? null : state.pullRequest,
    };
    publish();

    if (!branchName) {
      queriedPrBranch = null;
      return;
    }

    if (forcePullRequest || branchChanged) {
      queriedPrBranch = branchName;
      const pullRequest = await lookupPullRequest(ctx, branchName);
      if (refreshGeneration !== generation) return;
      state = { ...state, pullRequest };
      publish();
    }
  }

  function refresh(ctx: ExtensionContext, forcePullRequest = false) {
    if (refreshRunning) {
      refreshQueued = true;
      return;
    }
    refreshRunning = true;
    doRefresh(ctx, forcePullRequest, generation)
      .catch(() => undefined)
      .finally(() => {
        refreshRunning = false;
        if (refreshQueued && currentContext) {
          refreshQueued = false;
          refresh(currentContext, false);
        }
      });
  }

  function schedulePoll() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      if (currentContext) refresh(currentContext, false);
      schedulePoll();
    }, POLL_INTERVAL_MS);
  }

  const stopRefreshListener = pi.events.on(REFRESH_CHANNEL, () => {
    if (currentContext) refresh(currentContext, true);
  });

  pi.on("session_start", (_event, ctx) => {
    generation += 1;
    queriedPrBranch = null;
    currentContext = ctx;
    refresh(ctx, true);
    schedulePoll();
  });
  pi.on("input", (_event, ctx) => {
    refresh(ctx, false);
    return { action: "continue" as const };
  });
  pi.on("tool_execution_end", (_event, ctx) => refresh(ctx, false));
  pi.on("session_shutdown", () => {
    stopRefreshListener();
    generation += 1;
    currentContext = undefined;
    queriedPrBranch = null;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = undefined;
  });
}
