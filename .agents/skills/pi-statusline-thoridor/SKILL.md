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

## Helper script

`scripts/setup.mjs` is **the deterministic way to change state — use it instead of copying files or editing Pi settings by hand.** It merges settings atomically, is idempotent, prints a JSON result, and exits nonzero on failure. Requires only Node (which Pi itself runs on):

```bash
node "<skill-dir>/scripts/setup.mjs" <command> --scope global|project [--project-dir DIR]
```

| Command | Does |
|---|---|
| `check` | Read-only preflight: template present, per-scope installed/disabled state (add `--project-dir` to include project scope) |
| `install` | Copy the extension into the scope's Pi extensions dir (also clears a stale disable); accepts `--profile` and `--glyphs` |
| `config` | Set `--profile magni\|eli-magi\|off` and/or `--glyphs nerd\|unicode` persistently (written to the extension's `thoridor.json`; env vars override) |
| `disable` | Add the `extensions` exclude to the scope's Pi settings.json — the config-level off switch |
| `enable` | Remove that exclude |
| `uninstall` | Delete the extension dir and remove the exclude |

After any change: `/reload` in a running Pi (or restart it), then verify — footer present and `/thoridor-statusline` registered (or absent, after disable/uninstall). Read the printed JSON: `ok: false` carries an `error` saying what to fix.

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

1. **Preflight.** Run `setup.mjs check` (with `--project-dir` when in a project) and report the JSON plainly. An `installed: true` scope → offer in-place update (install overwrites cleanly); `disabled: true` → installing re-enables it. Warn (don't block) that the glyphs need a truecolor terminal and a Nerd Font. Note whether `gh` is installed/authenticated — without it the PR badge simply won't show.
2. **Ask the user**: global (all projects) or this project only? (Project installs live in `<project>/.pi/extensions/`, load only after the project is trusted in Pi, and are committable so teammates get it too.)
3. **Run** `setup.mjs install --scope global` (or `--scope project --project-dir "<project>"`).
4. **Profile & glyphs** (optional): default is `magni` + `nerd` with no configuration. Ask the glyph question — print these two exact test lines to the user:

   ```
   Nerd icons:    [  ]  ← lightning, folder, branch
   Unicode icons: [ϟ ⌂ ⎇]  ← the fallback set (works in any font)
   ```

   Then ask which line renders correctly. Nerd line empty/boxes → either set `--glyphs unicode` (works right now, no install) or install a Nerd Font via the **NERD FONT INSTALL** section below (optional, never required). Persist choices with `setup.mjs config --scope ... --profile eli-magi --glyphs unicode`; the `THORIDOR_PROFILE` / `THORIDOR_GLYPHS` env vars override per launch.
5. **Activate**: in a running Pi session, `/reload` picks the extension up; otherwise it loads on the next Pi start. Verify: three colored rows appear as the footer, and `/thoridor-statusline` responds with "Thoridor statusline refreshed".

## NERD FONT INSTALL (when the user opts for the nicer icons)

Recommend JetBrainsMono Nerd Font (any Nerd Font works). Run what you can; hand over where it's interactive:

- **macOS**: `brew install --cask font-jetbrains-mono-nerd-font`; no brew → download from nerdfonts.com/font-downloads and double-click the `.ttf` files → "Install Font".
- **Windows**: `winget install DEVCOM.JetBrainsMonoNerdFont`; or `scoop bucket add nerd-fonts && scoop install JetBrainsMono-NF`; or download the zip, select the `.ttf` files → right-click → Install.
- **Linux**: Arch: `sudo pacman -S ttf-jetbrains-mono-nerd`. Others: `mkdir -p ~/.local/share/fonts && unzip JetBrainsMono.zip -d ~/.local/share/fonts && fc-cache -fv`.

Then have the user **select the font in their terminal profile** (Windows Terminal: Settings → profile → Appearance → Font face; iTerm2: Settings → Profiles → Text; GNOME/Konsole/kitty/Ghostty: profile font setting; VS Code terminal: `terminal.integrated.fontFamily`). New font needs a fresh terminal window. Re-run the icon test; when icons render, `setup.mjs config --scope <scope> --glyphs nerd` and `/reload`.

## SWITCH PROFILE / GLYPHS

Persistent (preferred): `setup.mjs config --scope global|project --profile magni|eli-magi [--glyphs nerd|unicode]`, then `/reload` or restart Pi. Per-launch override: `THORIDOR_PROFILE` / `THORIDOR_GLYPHS` env vars set before launching Pi (env wins over the config file; a running Pi keeps the environment it started with).

## TURN OFF (disable in Pi config)

When the user asks to turn Thoridor off, disable it in Pi's config for the scope they name — ask global or project if unclear:

```bash
node "<skill-dir>/scripts/setup.mjs" disable --scope global
node "<skill-dir>/scripts/setup.mjs" disable --scope project --project-dir "<project>"
```

This adds a `-extensions/statusline-thoridor` force-exclude to that scope's `extensions` array in Pi's settings.json (merge-safe, idempotent). Then `/reload` in a running Pi (or restart) and verify the footer reverted to Pi's stock one and `/thoridor-statusline` is no longer registered. If the exclude doesn't take effect on this Pi version, fall back to moving the extension directory out of the extensions folder (e.g. to `statusline-thoridor.disabled/`). Re-enable with `setup.mjs enable --scope ...` (or move the directory back) and reload.

Quick alternative without touching config: launch with `THORIDOR_PROFILE=off` — the extension stays loaded but leaves Pi's stock footer and working indicator untouched.

## UNINSTALL

```bash
node "<skill-dir>/scripts/setup.mjs" uninstall --scope global   # or --scope project --project-dir "<project>"
```

Deletes the extension directory and removes any disable entry from that scope's settings, then `/reload` or restart Pi.

## HELP & TROUBLESHOOTING

- **Boxes / missing glyphs** → terminal font is not a Nerd Font. Quick fix: `setup.mjs config --scope <scope> --glyphs unicode` and `/reload` — renders in any font. Or install a Nerd Font and stay on `nerd`.
- **Washed-out colors** → terminal lacks truecolor.
- **No PR badge** → `gh` CLI missing or not authenticated for this repo's host; everything else still works.
- **No branch shown** → not a git repository, or git isn't installed.
- **Gauge never animates** → animation only runs while Pi is generating; also confirm the extension actually loaded (`/thoridor-statusline` should exist).
- **Statusline gone after `THORIDOR_PROFILE=off`** → that's the off profile doing its job; unset the variable and restart to bring it back.
- **Project install not loading** → the project must be trusted in Pi before `.pi/extensions/` entries load.
