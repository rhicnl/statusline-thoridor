---
name: claude-statusline-thoridor
description: Install, configure, or troubleshoot the Thoridor three-row animated statusline for Claude Code. Use when the user asks to install thoridor, set up the thoridor statusline, switch its profile (magni / eli-magi), turn it off, uninstall it, or asks how it works. Portable across Linux, macOS, and Windows; supports user-wide or per-project installation.
---

# Thoridor Statusline Installer

Thoridor is a three-row statusline for Claude Code:

1. **Identity** — `provider/model` and thinking effort.
2. **Location** — directory, git branch, changed-file count, and PR (separators in neutral gray).
3. **Context** — a 26-cell animated "thunder gauge" of context usage, percentage, tokens, and session cost.

Row colors are fixed — model row blue (`#3333ff`/`#0000ff`), folder/branch row red (`#ff0000`), context row yellow. Profiles pick the **row order** (or turn the statusline off):

| Profile | Row order |
|---|---|
| `magni` (default) | model / context gauge + cost / folder & branch |
| `eli-magi` | model / folder & branch / context gauge + cost |
| `off` | renders nothing — statusline hidden |

Files shipped next to this SKILL.md:

- `assets/thoridor.py` — the statusline renderer (reads statusline JSON on stdin; `--profile` flag; `--help` for full usage).
- `assets/working_state.py` — lifecycle-hook helper that tracks whether Claude is working, so the gauge animates only during generation.
- `scripts/setup.py` — **the deterministic installer. Use it for every state change; never hand-edit settings.json.** It merges settings atomically, is idempotent, prints a JSON result, and exits nonzero on failure.

## Helper script

Run with the platform python (`python3` on Linux/macOS, `python` on Windows), from any cwd:

```bash
python3 "<skill-dir>/scripts/setup.py" <command> [flags]
```

| Command | Flags | Does |
|---|---|---|
| `check` | `[--project-dir DIR]` | Read-only preflight: OS, python, git, existing installs/config per scope |
| `install` | `--scope user\|project [--profile magni\|eli-magi] [--glyphs nerd\|unicode] [--project-dir DIR] [--force]` | Copy assets, merge statusLine + 5 hooks, then verify — all in one |
| `set-profile` | `--scope ... --profile magni\|eli-magi\|off` | Change profile / turn off in that scope's settings.json |
| `set-glyphs` | `--scope ... --glyphs nerd\|unicode` | Switch icon set (unicode = works without a Nerd Font) |
| `uninstall` | `--scope ... [--project-dir DIR]` | Remove statusLine, hooks, and files for that scope |
| `verify` | `--scope ... [--project-dir DIR]` | Pipe a sample payload through the configured command |

Read the JSON it prints: `ok: true` means done (install includes a `verify` block); `ok: false` includes an `error` explaining what to fix. `install` refuses to overwrite a non-thoridor statusLine unless `--force` — surface that to the user and get their OK first.

## Mode selection

- User says install / set up → **INSTALL** (below).
- User wants the other profile, or the statusline temporarily off → **SWITCH PROFILE / TURN OFF**.
- User wants it gone → **UNINSTALL**.
- User asks how it works / it looks wrong → **HELP & TROUBLESHOOTING**.

## INSTALL

### Step 0 — Python bootstrap

The helper script itself runs on Python, so check for it with a plain shell command **before** anything else: `python3 --version` (Linux/macOS) or `python --version` (Windows; beware the Windows Store stub that opens the Store instead of running — `python -c "print(1)"` proves it's real).

If Python ≥ 3.10 is missing, don't just stop — help the user install it, then re-check:

- **Windows**: `winget install Python.Python.3.12` (or the installer from python.org — have them tick "Add python.exe to PATH"). New PATH needs a new terminal.
- **macOS**: `brew install python3` if Homebrew exists; otherwise `xcode-select --install` (ships python3) or the python.org installer.
- **Linux**: `sudo apt install python3` / `sudo dnf install python3` / `sudo pacman -S python` per distro.

Offer to run the command for them where possible; `sudo`/interactive installers they may need to run themselves. Only proceed to Step 1 once `python3 --version` (or `python --version`) reports ≥ 3.10.

### Step 1 — Preflight

Run `setup.py check` (add `--project-dir` when inside a project) and report its JSON to the user in plain words:

- `python_ok: false` → the found Python is older than 3.10; go back to Step 0 and help them install a current one.
- `git: false` → row 2 will show no branch; mention it, don't block.
- A scope with `statusline_configured: true` but `statusline_is_thoridor: false` → an unrelated statusline exists there; show its command and confirm before replacing (then pass `--force` to install). A project-level `statusLine` overrides the user-level one.
- A scope with `installed: true` → offer an in-place update instead of a fresh install.

Also check the terminal: truecolor is required (Windows Terminal, iTerm2, kitty, etc. are fine; legacy cmd.exe is not). A Nerd Font is **optional** — see the glyph question in Step 2.

### Step 2 — Ask the user

Use AskUserQuestion with two questions:

1. **Scope** — "Install for your user (all projects) or just this project?"
   - *User (recommended)*: files → `~/.claude/statuslines/thoridor/`, config → `~/.claude/settings.json`.
   - *Project*: files → `<project>/.claude/statuslines/thoridor/`, config → `<project>/.claude/settings.json` (committable, applies to teammates too).
2. **Profile** — `magni` (model / context / location — recommended default) or `eli-magi` (model / location / context).
3. **Glyphs** — first print this exact test line to the user: `Icon test: [  ] ← do these render as a lightning bolt, folder, and branch symbol?` Then ask: icons visible → `nerd` (recommended); boxes/blanks/question marks → offer BOTH options: (a) `unicode` glyphs, which work in any font right now (the gauge uses `ϟ`), or (b) install a Nerd Font — follow the **NERD FONT INSTALL** section below — then use `nerd`. Font install is optional — never a requirement.

If not inside a project directory, skip question 1 and install user-wide.

### Step 3 — Run the installer

```bash
python3 "<skill-dir>/scripts/setup.py" install --scope user --profile magni --glyphs nerd
# or: ... install --scope project --project-dir "<project>" --profile eli-magi --glyphs unicode
```

One command does everything: copies the files, merges settings.json (statusLine + the five animation hooks), and verifies by piping a sample payload through the exact configured command. Report the JSON result; on `ok: true` tell the user to restart Claude Code (or start a new session) and how to switch profiles later. On `ok: false`, fix what the `error` says and rerun.

The manual steps below describe what the script does — use them only if the script itself cannot run.

### Manual fallback — Copy files

Copy `assets/thoridor.py` and `assets/working_state.py` into the chosen install dir (create it first). Never copy `.state/` or `__pycache__/` if updating an old install.

### Manual fallback — Wire settings.json

**Merge, never overwrite** the target settings.json (preserve all existing keys; create the file with `{}` semantics if absent).

Statusline entry — use the absolute path for user scope; for project scope use `$CLAUDE_PROJECT_DIR` so the config is portable across clones:

```json
{
  "statusLine": {
    "type": "command",
    "command": "python3 \"<INSTALL_DIR>/thoridor.py\" --profile <PROFILE>",
    "padding": 0,
    "refreshInterval": 1
  }
}
```

- On Windows use `python` instead of `python3`. Do not use `uv run` — it adds ~40 ms per refresh for no benefit.
- Windows paths in JSON need escaped backslashes (`C:\\Users\\...`) — or use forward slashes, which Python accepts.
- `refreshInterval: 1` keeps the thunder animation alive; a user who doesn't care about the animation can raise it to 2 to halve the overhead.

Hooks entry — append (don't replace) a hook to **each** of `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, and `SessionEnd`, using the same python command style:

```json
{
  "hooks": [
    { "type": "command", "command": "python3 \"<INSTALL_DIR>/working_state.py\"", "timeout": 5 }
  ]
}
```

These hooks only toggle a per-session flag in `<INSTALL_DIR>/.state/` so the gauge animates while Claude is working. Skipping them is allowed (statusline still renders, gauge just stays static) — but install them by default.

Performance notes baked into the script (no action needed): git branch/status results are cached per directory in `<INSTALL_DIR>/.state/` with a 4-second TTL, written atomically; while Claude is generating, stale git details are reused for up to 5 minutes so the animation never pays for git subprocesses.

### Manual fallback — Verify

Pipe a sample payload through the exact command you configured, e.g.:

```bash
echo '{"model":{"id":"claude-opus-5"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42,"context_window_size":200000,"current_usage":{"total":84000}},"cost":{"total_cost_usd":1.23}}' | <configured command>
```

Expect three colored rows and exit code 0. Then tell the user to restart Claude Code (or start a new session) to see it live, and how to switch profiles later.

## NERD FONT INSTALL (when the user opts for the nicer icons)

Recommend JetBrainsMono Nerd Font (any Nerd Font works). Run what you can for the user; hand over where it's interactive:

- **macOS**: `brew install --cask font-jetbrains-mono-nerd-font` (no tap needed on current Homebrew). No brew → download the zip from nerdfonts.com/font-downloads, unzip, double-click the `.ttf` files → "Install Font" (or copy to `~/Library/Fonts/`).
- **Windows**: `winget install DEVCOM.JetBrainsMonoNerdFont`; or with scoop: `scoop bucket add nerd-fonts && scoop install JetBrainsMono-NF`; or download the zip, select all `.ttf` files → right-click → Install.
- **Linux**: Arch: `sudo pacman -S ttf-jetbrains-mono-nerd`. Others (works everywhere): download the zip, `mkdir -p ~/.local/share/fonts && unzip JetBrainsMono.zip -d ~/.local/share/fonts && fc-cache -fv`.

Then the crucial step users forget — **select the font in the terminal profile** (installing alone changes nothing):

- Windows Terminal: Settings → profile → Appearance → Font face → "JetBrainsMono Nerd Font".
- iTerm2: Settings → Profiles → Text → Font. macOS Terminal.app: Settings → Profiles → Font.
- GNOME Terminal / Konsole / kitty / Ghostty: the profile's font setting or config file.
- VS Code integrated terminal: setting `terminal.integrated.fontFamily` = `"JetBrainsMono Nerd Font"`.

New font usually needs a fresh terminal window. Finish by re-running the icon test line from Step 2; when icons render, set glyphs to `nerd` (`setup.py set-glyphs --scope <scope> --glyphs nerd`).

## SWITCH PROFILE / TURN OFF

Both are one script call against the scope the user names (ask if unclear which settings.json they mean):

```bash
python3 "<skill-dir>/scripts/setup.py" set-profile --scope user --profile eli-magi
python3 "<skill-dir>/scripts/setup.py" set-profile --scope user --profile off        # turn off
python3 "<skill-dir>/scripts/setup.py" set-profile --scope project --project-dir "<project>" --profile off
```

`off` makes the script render nothing — statusline hidden, install intact; a real profile brings it back. The project form works even when only a user-level install exists: it writes a project override entry pointing at the user install (project settings override user settings), so a single project can be off while the rest stay on. Changes apply on the next Claude Code session.

## UNINSTALL

```bash
python3 "<skill-dir>/scripts/setup.py" uninstall --scope user
# or: ... uninstall --scope project --project-dir "<project>"
```

Removes the `statusLine` entry, the five `working_state.py` hooks, and the install dir for that scope — nothing else is touched. The JSON result reports exactly what was removed.

## HELP & TROUBLESHOOTING

- **Boxes / missing glyphs** → terminal font is not a Nerd Font. Quick fix: `setup.py set-glyphs --scope <scope> --glyphs unicode` (works in any font). Nicer fix: install a Nerd Font from nerdfonts.com, select it in the terminal profile, and stay on `nerd`.
- **Wrong / washed-out colors** → terminal lacks truecolor; use Windows Terminal, iTerm2, kitty, Ghostty, or any 24-bit-color terminal.
- **Gauge never animates** → the `working_state.py` hooks are missing or point at the wrong path; re-run INSTALL Step 4. Also note Claude only refreshes the statusline about once per second, so the animation is coarse by design.
- **No branch on row 2** → not a git repo, or git isn't installed.
- **Branch/changed-count looks stale** → expected: git info is cached for 4 s (up to 5 min while Claude is generating). Delete `<INSTALL_DIR>/.state/git-*.json` to force a refresh.
- **Feels sluggish** → make sure the configured command is direct `python3`/`python`, not `uv run`.
- **`ModuleNotFoundError: working_state`** → `thoridor.py` and `working_state.py` must sit in the same directory.
- **Statusline shows an error line** → run the Step 5 verify command manually to see the traceback.
- `assets/thoridor.py --help` prints the full built-in usage text.
