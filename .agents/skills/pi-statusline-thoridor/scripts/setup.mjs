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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE_DIR = path.join(SKILL_DIR, "templates", "statusline-thoridor");
const EXT_NAME = "statusline-thoridor";
const EXCLUDE_ENTRY = `-extensions/${EXT_NAME}`;

function out(result, code = result.ok ? 0 : 1) {
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

function saveSettings(file, data) {
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
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return config;
}

function cmdCheck(args) {
  const report = { ok: true, node: process.version, template: fs.existsSync(path.join(TEMPLATE_DIR, "index.ts")), scopes: {} };
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
  const config = args.profile !== undefined || args.glyphs !== undefined ? writeLocalConfig(extDir, args) : undefined;
  return { ok: true, action: "install", scope: args.scope, ext_dir: extDir, reenabled, ...(config ? { config } : {}), next: "run /reload in Pi or restart it" };
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
