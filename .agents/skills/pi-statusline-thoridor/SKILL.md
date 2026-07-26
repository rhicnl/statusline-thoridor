---
name: pi-statusline-thoridor
description: "Install, configure, or troubleshoot the Thoridor three-row animated statusline for the Pi coding agent. Use when the user asks to install thoridor in pi, set up the pi thoridor statusline, switch its profile (magni / eli-magi), turn it off, uninstall it, or asks how it works. Installs as a Pi extension, globally or per project."
---

# Thoridor Statusline for Pi (extension installer)

Thoridor is a three-row statusline. This skill installs it as a **Pi extension** from the bundled template.

- **Model row** (blue `#3333ff`/`#0000ff`) — provider/model, thinking level, and `[session name]`.
- **Context row** (yellow) — a 26-cell thunder gauge that *animates while Pi is generating*, percentage, tokens, tok/s, and session cost.
- **Location row** (red `#ff0000`) — directory, git branch, changed-file count, PR badge; MCP server count right-aligned.

Row colors are fixed; the **profile** (via the `THORIDOR_PROFILE` env var) picks the row order — or turns the statusline off:

| Profile | Rows |
|---|---|
| `magni` (default) | model / context / location |
| `eli-magi` | model / location / context |
| `off` | extension leaves Pi's stock footer untouched |

## Template contents (`templates/statusline-thoridor/`)

- `index.ts` — extension entry point; wires up the four installers below.
- `src/model-info.ts` — tracks model/provider/thinking via `model_select` and `thinking_level_select` events.
- `src/token-info.ts` — tracks context usage, cost, live tok/s estimate, and the `generating` flag that drives the animation.
- `src/git-info.ts` — polls git every 3 s (branch, changed files) and looks up the PR badge with the `gh` CLI (optional — silently omitted if `gh` is missing or unauthenticated).
- `src/mcp-info.ts` — condenses Pi's MCP footer status to `MCP n/m`.
- `src/statusline-renderer.ts` — installs the footer, manages the 120 ms animation timer, registers the `/thoridor-statusline` refresh command, honors `off`.
- `src/thoridor-statusline-renderer.ts` — renders the three rows; profiles and colors live here.
- `src/state.ts`, `src/ansi.ts` — shared state types/channels (`statusline-thoridor:*`) and ANSI helpers.

The extension is self-contained: it imports only `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and Node builtins — all available inside Pi.

## Mode selection

- Install / set up → **INSTALL**.
- Other profile or temporarily off → **SWITCH PROFILE / TURN OFF**.
- Remove → **UNINSTALL**.
- Questions / looks wrong → **HELP & TROUBLESHOOTING**.

## INSTALL

1. **Preflight.** Confirm you are dealing with Pi (`~/.pi/` exists or the user says so). Check for an existing install at `~/.pi/agent/extensions/statusline-thoridor/` or `<project>/.pi/extensions/statusline-thoridor/` — if present, offer an in-place update. Warn (don't block) that the glyphs need a truecolor terminal and a Nerd Font. Note whether `gh` is installed/authenticated — without it the PR badge simply won't show.
2. **Ask the user**: global (all projects) or this project only?
   - *Global*: copy the template directory to `~/.pi/agent/extensions/statusline-thoridor/`.
   - *Project*: copy to `<project>/.pi/extensions/statusline-thoridor/` (loads only after the project is trusted in Pi; committable so teammates get it too).
3. **Copy** `templates/statusline-thoridor/` (the whole directory: `index.ts` + `src/`) to the chosen location.
4. **Profile** (optional): default is `magni` with no configuration. For `eli-magi` or `off`, the user sets `THORIDOR_PROFILE` in the environment Pi starts from (e.g. `export THORIDOR_PROFILE=eli-magi` in their shell rc).
5. **Activate**: in a running Pi session, `/reload` picks the extension up; otherwise it loads on the next Pi start. Verify: three colored rows appear as the footer, and `/thoridor-statusline` responds with "Thoridor statusline refreshed".

## SWITCH PROFILE

Set `THORIDOR_PROFILE` to `magni` or `eli-magi` in the environment Pi launches from (shell rc or the launch command, e.g. `THORIDOR_PROFILE=eli-magi pi`). A running Pi keeps the environment it started with, so after changing the variable the user must restart Pi.

## TURN OFF (disable in Pi config)

When the user asks to turn Thoridor off, disable the extension in the Pi settings for the scope they name — ask global or project if unclear:

- **Global**: in `~/.pi/agent/settings.json`, add a force-exclude for the extension to the `extensions` array (paths resolve relative to `~/.pi/agent`):

  ```json
  { "extensions": ["-extensions/statusline-thoridor"] }
  ```

- **Project**: same entry in `<project>/.pi/settings.json` (paths resolve relative to `.pi`, so the same `-extensions/statusline-thoridor` value excludes the project copy).

Merge into the existing JSON — never drop other keys or existing `extensions` entries. Then `/reload` in a running Pi (or restart) and verify the footer reverted to Pi's stock one and `/thoridor-statusline` is no longer registered. If the exclude doesn't take effect on this Pi version, fall back to moving the extension directory out of the extensions folder (e.g. to `statusline-thoridor.disabled/`). Re-enable by removing the exclude entry (or moving the directory back) and reloading.

Quick alternative without touching config: launch with `THORIDOR_PROFILE=off` — the extension stays loaded but leaves Pi's stock footer and working indicator untouched.

## UNINSTALL

Delete the extension directory (`.../extensions/statusline-thoridor/`), then `/reload` or restart Pi. Nothing else is written anywhere — no settings to clean up.

## HELP & TROUBLESHOOTING

- **Boxes / missing glyphs** → terminal font is not a Nerd Font (needs U+F0E7, U+F07B, U+E0A0).
- **Washed-out colors** → terminal lacks truecolor.
- **No PR badge** → `gh` CLI missing or not authenticated for this repo's host; everything else still works.
- **No branch shown** → not a git repository, or git isn't installed.
- **Gauge never animates** → animation only runs while Pi is generating; also confirm the extension actually loaded (`/thoridor-statusline` should exist).
- **Statusline gone after `THORIDOR_PROFILE=off`** → that's the off profile doing its job; unset the variable and restart to bring it back.
- **Project install not loading** → the project must be trusted in Pi before `.pi/extensions/` entries load.
