import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installGitInfo } from "./src/git-info.ts";
import { installModelInfo } from "./src/model-info.ts";
import { installStatuslineRenderer } from "./src/statusline-renderer.ts";
import { installTokenInfo } from "./src/token-info.ts";

/**
 * Thoridor: a self-contained three-row Pi statusline with independently timed
 * thunder strikes in the context gauge.
 */
export default function statuslineThoridor(pi: ExtensionAPI) {
  installModelInfo(pi);
  installTokenInfo(pi);
  installGitInfo(pi);
  installStatuslineRenderer(pi);
}
