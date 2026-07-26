#!/usr/bin/env node
// Deterministic installer/manager for the Thoridor Pi statusline extension.
//
// Usage: node setup.mjs <command> [--scope global|project] [--project-dir DIR] [--home DIR]
//
// Commands:
//   check       preflight report (read-only; pass --project-dir to include project scope)
//   install     copy the extension template into the scope's Pi extensions dir
//               (accepts --profile magni|eli-magi|off and --glyphs nerd|unicode)
//   config      set --profile and/or --glyphs in the installed extension's thoridor.json
//   disable     add an `extensions` exclude for the extension to the scope's Pi settings
//   enable      remove that exclude
//   uninstall   delete the extension dir and remove the exclude
//
// Exit codes: 0 success, 1 failure, 2 usage error.
// Settings edits are merges (other keys untouched) with atomic writes.
// Every command prints a JSON result.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE_DIR = path.join(SKILL_DIR, "templates", "statusline-thoridor");
const EXT_NAME = "statusline-thoridor";
const EXCLUDE_ENTRY = `-extensions/${EXT_NAME}`;

const settingsBackups = [];

function out(result, code = result.ok ? 0 : 1) {
  if (settingsBackups.length > 0) result.settings_backups = settingsBackups;
  console.log(JSON.stringify(result, null, 2));
  process.exit(code);
}

function fail(error, code = 1) {
  out({ ok: false, error }, code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--scope") args.scope = argv[++i];
    else if (a === "--project-dir") args.projectDir = argv[++i];
    else if (a === "--home") args.home = argv[++i];
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--glyphs") args.glyphs = argv[++i];
    else if (a.startsWith("--")) fail(`unknown flag: ${a}`, 2);
    else args._.push(a);
  }
  return args;
}

function resolvePaths(scope, projectDir, home) {
  if (scope === "global") {
    const base = path.join(home ?? os.homedir(), ".pi", "agent");
    return { extDir: path.join(base, "extensions", EXT_NAME), settings: path.join(base, "settings.json") };
  }
  if (!projectDir) fail("--project-dir is required for --scope project", 2);
  const base = path.join(path.resolve(projectDir), ".pi");
  return { extDir: path.join(base, "extensions", EXT_NAME), settings: path.join(base, "settings.json") };
}

function loadSettings(file) {
  if (!fs.existsSync(file)) return {};
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot parse ${file}: ${error.message} — fix or back up the file first`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) fail(`${file} is not a JSON object`);
  return data;
}

// Failsafe: copy an existing config file aside before the first write to it
// (settings.json and thoridor.json alike).
function backupFile(file) {
  if (!fs.existsSync(file) || settingsBackups.some((b) => b.startsWith(`${file}.bak-`))) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  let backup = `${file}.bak-${stamp}`;
  for (let counter = 1; fs.existsSync(backup); counter++) backup = `${file}.bak-${stamp}-${counter}`;
  fs.copyFileSync(file, backup);
  settingsBackups.push(backup);
}

function saveSettings(file, data) {
  backupFile(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

function isDisabled(settings) {
  return Array.isArray(settings.extensions) && settings.extensions.includes(EXCLUDE_ENTRY);
}

const PROFILES = ["magni", "eli-magi", "off"];
const GLYPH_MODES = ["nerd", "unicode"];

function writeLocalConfig(extDir, args) {
  const file = path.join(extDir, "thoridor.json");
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  if (args.profile !== undefined) {
    if (!PROFILES.includes(args.profile)) fail(`--profile must be one of: ${PROFILES.join(", ")}`, 2);
    config.profile = args.profile;
  }
  if (args.glyphs !== undefined) {
    if (!GLYPH_MODES.includes(args.glyphs)) fail(`--glyphs must be one of: ${GLYPH_MODES.join(", ")}`, 2);
    config.glyphs = args.glyphs;
  }
  const content = JSON.stringify(config, null, 2) + "\n";
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf8") === content) return config; // unchanged — no write, no backup
    backupFile(file);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  return config;
}

const NERD_NAME_RE = /nerd ?font|(^|[ \-_])nf([ \-_.)]|$)/i;

// Find installed Nerd Fonts (names/files matching "Nerd Font" or the "NF" suffix).
// Installed is not the same as selected: the terminal profile must actually use one.
function detectNerdFonts(home) {
  const found = new Set();
  const scanNames = (names) => {
    for (const n of names) if (n && NERD_NAME_RE.test(n)) found.add(String(n).trim());
  };
  const scanDirs = (dirs) => {
    for (const d of dirs) {
      if (!d) continue;
      try {
        for (const entry of fs.readdirSync(d, { recursive: true, withFileTypes: false })) {
          const base = path.basename(String(entry));
          if (/\.(ttf|otf)$/i.test(base)) scanNames([base.replace(/\.(ttf|otf)$/i, "")]);
        }
      } catch {
        /* dir missing or unreadable */
      }
    }
  };
  if (process.platform === "win32") {
    for (const key of [
      "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
      "HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
    ]) {
      try {
        scanNames(execFileSync("reg", ["query", key], { encoding: "utf8", timeout: 15000 }).split(/\r?\n/));
      } catch {
        /* reg unavailable */
      }
    }
    scanDirs([
      path.join(process.env.WINDIR || "C:\\Windows", "Fonts"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts"),
    ]);
  } else if (process.platform === "darwin") {
    scanDirs([path.join(home, "Library", "Fonts"), "/Library/Fonts", "/System/Library/Fonts"]);
  } else {
    try {
      scanNames(execFileSync("fc-list", [":", "family"], { encoding: "utf8", timeout: 15000 }).split("\n"));
    } catch {
      /* fc-list unavailable */
    }
    scanDirs([path.join(home, ".local", "share", "fonts"), path.join(home, ".fonts"), "/usr/share/fonts", "/usr/local/share/fonts"]);
  }
  return {
    installed: found.size > 0,
    families: [...found].sort().slice(0, 10),
    note: "installed, not necessarily selected — the terminal profile must use one of these for nerd glyphs to render",
  };
}

function cmdCheck(args) {
  const report = {
    ok: true,
    node: process.version,
    template: fs.existsSync(path.join(TEMPLATE_DIR, "index.ts")),
    nerd_fonts: detectNerdFonts(args.home || os.homedir()),
    scopes: {},
  };
  const scopes = [["global", null]];
  if (args.projectDir) scopes.push(["project", args.projectDir]);
  for (const [scope, projectDir] of scopes) {
    const { extDir, settings: settingsPath } = resolvePaths(scope, projectDir, args.home);
    const settings = loadSettings(settingsPath);
    report.scopes[scope] = {
      ext_dir: extDir,
      installed: fs.existsSync(path.join(extDir, "index.ts")),
      settings: settingsPath,
      disabled: isDisabled(settings),
    };
  }
  return report;
}

function cmdInstall(args) {
  if (!fs.existsSync(path.join(TEMPLATE_DIR, "index.ts"))) fail(`template missing at ${TEMPLATE_DIR}`);
  const { extDir, settings: settingsPath } = resolvePaths(args.scope, args.projectDir, args.home);
  fs.mkdirSync(path.dirname(extDir), { recursive: true });
  fs.cpSync(TEMPLATE_DIR, extDir, { recursive: true });
  // A fresh install implies the user wants it on: drop any stale exclude.
  const settings = loadSettings(settingsPath);
  let reenabled = false;
  if (isDisabled(settings)) {
    settings.extensions = settings.extensions.filter((e) => e !== EXCLUDE_ENTRY);
    if (settings.extensions.length === 0) delete settings.extensions;
    saveSettings(settingsPath, settings);
    reenabled = true;
  }
  // Materialize the scope's settings.json so the install is a complete,
  // visible Pi config dir; a missing file is seeded from the settings template,
  // which explicitly enables the extension.
  let settingsCreated = false;
  if (!fs.existsSync(settingsPath)) {
    const templateFile = path.join(SKILL_DIR, "templates", "settings.template.json");
    const seed = fs.existsSync(templateFile) ? JSON.parse(fs.readFileSync(templateFile, "utf8")) : settings;
    saveSettings(settingsPath, seed);
    settingsCreated = true;
  }
  // Always materialize the scope's config so the install is explicit on disk;
  // re-installs keep previously configured values unless flags override them.
  const configFile = path.join(extDir, "thoridor.json");
  const existing = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  const config = writeLocalConfig(extDir, {
    profile: args.profile ?? existing.profile ?? "magni",
    glyphs: args.glyphs ?? existing.glyphs ?? "nerd",
  });
  // A project install must beat an existing global install, which requires the
  // global copy to carry the yield-to-project guard. Refresh the global copy's
  // code too (its thoridor.json config is untouched) so scopes never diverge.
  let globalRefreshed = false;
  if (args.scope === "project") {
    const { extDir: globalExtDir } = resolvePaths("global", null, args.home);
    if (fs.existsSync(path.join(globalExtDir, "index.ts"))) {
      fs.cpSync(TEMPLATE_DIR, globalExtDir, { recursive: true });
      globalRefreshed = true;
    }
  }
  return { ok: true, action: "install", scope: args.scope, ext_dir: extDir, settings: settingsPath, settings_created: settingsCreated, reenabled, config, global_extension_refreshed: globalRefreshed, next: "run /reload in Pi or restart it" };
}

function cmdConfig(args) {
  const { extDir } = resolvePaths(args.scope, args.projectDir, args.home);
  if (!fs.existsSync(path.join(extDir, "index.ts"))) fail(`extension not installed at ${extDir} — run install first`);
  if (args.profile === undefined && args.glyphs === undefined) fail("pass --profile and/or --glyphs", 2);
  const config = writeLocalConfig(extDir, args);
  return { ok: true, action: "config", scope: args.scope, config, next: "run /reload in Pi or restart it (THORIDOR_PROFILE/THORIDOR_GLYPHS env vars override this file)" };
}

function cmdDisable(args) {
  const { settings: settingsPath } = resolvePaths(args.scope, args.projectDir, args.home);
  const settings = loadSettings(settingsPath);
  if (!isDisabled(settings)) {
    settings.extensions = [...(settings.extensions ?? []), EXCLUDE_ENTRY];
    saveSettings(settingsPath, settings);
  }
  return { ok: true, action: "disable", scope: args.scope, settings: settingsPath, next: "run /reload in Pi or restart, then confirm the stock footer is back" };
}

function cmdEnable(args) {
  const { settings: settingsPath } = resolvePaths(args.scope, args.projectDir, args.home);
  const settings = loadSettings(settingsPath);
  let changed = false;
  if (isDisabled(settings)) {
    settings.extensions = settings.extensions.filter((e) => e !== EXCLUDE_ENTRY);
    if (settings.extensions.length === 0) delete settings.extensions;
    saveSettings(settingsPath, settings);
    changed = true;
  }
  return { ok: true, action: "enable", scope: args.scope, changed, next: "run /reload in Pi or restart it" };
}

function cmdUninstall(args) {
  const { extDir, settings: settingsPath } = resolvePaths(args.scope, args.projectDir, args.home);
  const removedFiles = fs.existsSync(extDir);
  if (removedFiles) fs.rmSync(extDir, { recursive: true });
  const settings = loadSettings(settingsPath);
  let removedExclude = false;
  if (isDisabled(settings)) {
    settings.extensions = settings.extensions.filter((e) => e !== EXCLUDE_ENTRY);
    if (settings.extensions.length === 0) delete settings.extensions;
    saveSettings(settingsPath, settings);
    removedExclude = true;
  }
  return { ok: true, action: "uninstall", scope: args.scope, removed_files: removedFiles, removed_exclude: removedExclude };
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const handlers = { check: cmdCheck, install: cmdInstall, config: cmdConfig, disable: cmdDisable, enable: cmdEnable, uninstall: cmdUninstall };
if (!command || !handlers[command]) fail(`usage: setup.mjs check|install|config|disable|enable|uninstall [--scope global|project] [--project-dir DIR] [--profile P] [--glyphs G]`, 2);
if (command !== "check" && !["global", "project"].includes(args.scope ?? "")) fail(`--scope global|project is required for ${command}`, 2);
out(handlers[command](args));
