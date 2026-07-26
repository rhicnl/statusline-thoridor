import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  // When installed in both scopes, Pi keeps the project copy and the global
  // copy loaded side by side and the last-installed footer wins — which is the
  // global one, silently overriding the project's profile/glyph config. The
  // global copy therefore yields whenever a project copy exists for the
  // current project (a project copy only loads once the project is trusted).
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const projectCopy = path.resolve(process.cwd(), ".pi", "extensions", "statusline-thoridor");
  if (here !== projectCopy && fs.existsSync(path.join(projectCopy, "index.ts"))) return;

  installModelInfo(pi);
  installTokenInfo(pi);
  installGitInfo(pi);
  installStatuslineRenderer(pi);
}
