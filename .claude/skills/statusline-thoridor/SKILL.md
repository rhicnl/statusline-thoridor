---
name: statusline-thoridor
description: Install, configure, or troubleshoot the Thoridor three-row animated statusline for Claude Code. Use when the user asks to install thoridor, set up the thoridor statusline, switch its color profile (magni / eli-magi), uninstall it, or asks how it works. Portable across Linux, macOS, and Windows; supports user-wide or per-project installation.
---

# Thoridor Statusline Installer

Thoridor is a three-row statusline for Claude Code:

1. **Identity** — `provider/model` and thinking effort.
2. **Location** — directory, git branch, changed-file count, and PR (separators in neutral gray).
3. **Context** — a 26-cell animated "thunder gauge" of context usage, percentage, tokens, and session cost.

Two color profiles:

| Profile | Row 1 (model/effort) | Row 2 (dir/git) |
|---|---|---|
| `magni` (default) | blue `#3333ff` / `#0000ff` | red `#ff0000` |
| `eli-magi` | red `#ff0000` / `#cc0000` | blue `#3333ff` |

Files shipped in `assets/` next to this SKILL.md:

- `thoridor.py` — the statusline renderer (reads statusline JSON on stdin; `--profile` flag; `--help` for full usage).
- `working_state.py` — lifecycle-hook helper that tracks whether Claude is working, so the gauge animates only during generation.

## Mode selection

- User says install / set up → **INSTALL** (below).
- User wants the other profile → **SWITCH PROFILE**.
- User wants it gone → **UNINSTALL**.
- User asks how it works / it looks wrong → **HELP & TROUBLESHOOTING**.

## INSTALL

### Step 1 — Preflight

Run these checks and report results before changing anything:

1. **OS**: detect Linux / macOS / Windows (`platform.system()` via python, or `uname` / `$env:OS`). This decides the python command used in hooks: `python3` on Linux/macOS, `python` on Windows.
2. **Python**: confirm Python ≥ 3.10 is available (`python3 --version` or `python --version`). Always configure the statusline with **direct python**, not `uv run` — the script has no third-party dependencies and skipping uv saves ~40 ms on every refresh (the statusline re-runs about once per second).
3. **Git** (optional): if missing, row 2 simply shows no branch — mention it, don't block.
4. **Existing statusline**: read both `~/.claude/settings.json` and, if inside a project, `<project>/.claude/settings.json`. If a `statusLine` entry already exists in either, tell the user what is configured where and confirm before replacing it. Remember: a project-level `statusLine` overrides the user-level one.
5. **Existing thoridor install**: look for `~/.claude/statuslines/thoridor/` and `<project>/.claude/statuslines/thoridor/`. If found, offer to update in place instead of installing fresh.
6. **Terminal**: warn (don't block) that the gauge needs a truecolor terminal and a Nerd Font (glyphs U+F0E7, U+F07B, U+E0A0). Windows Terminal, iTerm2, kitty, etc. are fine; legacy cmd.exe is not.

### Step 2 — Ask the user

Use AskUserQuestion with two questions:

1. **Scope** — "Install for your user (all projects) or just this project?"
   - *User (recommended)*: files → `~/.claude/statuslines/thoridor/`, config → `~/.claude/settings.json`.
   - *Project*: files → `<project>/.claude/statuslines/thoridor/`, config → `<project>/.claude/settings.json` (committable, applies to teammates too).
2. **Profile** — `magni` (blue row 1, red row 2 — recommended default) or `eli-magi` (red row 1, blue row 2).

If not inside a project directory, skip question 1 and install user-wide.

### Step 3 — Copy files

Copy `assets/thoridor.py` and `assets/working_state.py` into the chosen install dir (create it first). Never copy `.state/` or `__pycache__/` if updating an old install.

### Step 4 — Wire settings.json

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

### Step 5 — Verify

Pipe a sample payload through the exact command you configured, e.g.:

```bash
echo '{"model":{"id":"claude-opus-5"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42,"context_window_size":200000,"current_usage":{"total":84000}},"cost":{"total_cost_usd":1.23}}' | <configured command>
```

Expect three colored rows and exit code 0. Then tell the user to restart Claude Code (or start a new session) to see it live, and how to switch profiles later.

## SWITCH PROFILE

Edit the `--profile` value in the configured `statusLine.command` (find it in whichever settings.json holds it). Alternatively the user can set the `THORIDOR_PROFILE` env var — the flag wins over the env var.

## UNINSTALL

1. Remove the `statusLine` block and the five `working_state.py` hook entries from the settings.json that holds them (leave all other hooks/keys untouched).
2. Delete the install dir (`.../statuslines/thoridor/`).

## HELP & TROUBLESHOOTING

- **Boxes / missing glyphs** → terminal font is not a Nerd Font. Install one (e.g. from nerdfonts.com) and select it in the terminal profile.
- **Wrong / washed-out colors** → terminal lacks truecolor; use Windows Terminal, iTerm2, kitty, Ghostty, or any 24-bit-color terminal.
- **Gauge never animates** → the `working_state.py` hooks are missing or point at the wrong path; re-run INSTALL Step 4. Also note Claude only refreshes the statusline about once per second, so the animation is coarse by design.
- **No branch on row 2** → not a git repo, or git isn't installed.
- **Branch/changed-count looks stale** → expected: git info is cached for 4 s (up to 5 min while Claude is generating). Delete `<INSTALL_DIR>/.state/git-*.json` to force a refresh.
- **Feels sluggish** → make sure the configured command is direct `python3`/`python`, not `uv run`.
- **`ModuleNotFoundError: working_state`** → `thoridor.py` and `working_state.py` must sit in the same directory.
- **Statusline shows an error line** → run the Step 5 verify command manually to see the traceback.
- `assets/thoridor.py --help` prints the full built-in usage text.
