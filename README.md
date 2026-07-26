# statusline-thoridor

A three-row animated statusline for [Claude Code](https://claude.com/claude-code) **and** the [Pi](https://github.com/badlogic/pi-mono) coding agent (where Thoridor originally comes from). This repo is all you need — this README plus, for each agent, the statusline packaged as an installer skill that sets everything up itself.

> ⚡ The guide below walks through the Claude Code version; Pi users jump to [Pi version](#pi-version).

```
 anthropic/claude-opus-5  xhigh
 ϟϟϟϟϟϟϟϟϟϟϟ··············· 42% (84k/200k)                                $1.23
  \~/dev/my-project ·  main · 3 changed · PR#42
```

- **Model row** (blue) — provider/model and thinking effort.
- **Context row** (yellow) — a 26-cell thunder gauge of context usage that *animates while Claude is working*, plus percentage, tokens, and session cost.
- **Location row** (red) — directory, git branch, changed-file count, and PR.

Colors are fixed; the **profile** picks the row order — or turns the statusline off:

| Profile | Rows |
|---|---|
| `magni` (default) | model / context / location |
| `eli-magi` | model / location / context |
| `off` | statusline hidden (nothing rendered) |

## Requirements

- Claude Code version: Python 3.10 or newer (`python3 --version` / `python --version`); the installer helps set it up if missing. Pi version: nothing extra — Pi's own Node runtime is all it needs
- A truecolor terminal (Windows Terminal, iTerm2, kitty, Ghostty, and most modern terminals)
- Optional: a [Nerd Font](https://www.nerdfonts.com/) for the fancy lightning/folder/branch icons — **not required**: the `unicode` glyph mode renders `ϟ` gauge, `⌂` folder, and `⎇` branch icons in any normal font (the installer asks which you want)
- Works on Linux, macOS, and Windows

## Easy install (recommended)

Copy the skill into your Claude Code skills folder:

**Linux / macOS**

```bash
git clone https://github.com/rhicnl/statusline-thoridor
mkdir -p ~/.claude/skills
cp -r statusline-thoridor/.claude/skills/claude-statusline-thoridor ~/.claude/skills/
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/rhicnl/statusline-thoridor
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse statusline-thoridor\.claude\skills\claude-statusline-thoridor "$HOME\.claude\skills\"
```

Then start (or restart) Claude Code and type:

```
/claude-statusline-thoridor install
```

Claude checks your system, asks two questions (install for your user or just this project? which color profile?), wires everything up, and verifies it. Afterwards, restart Claude Code and enjoy the lightning. ⚡

Later you can also say things like *"switch thoridor to eli-magi"*, *"turn the thoridor statusline off"* (yes, that's allowed 😄 — profile `off` hides it without uninstalling), *"uninstall thoridor"*, or *"my statusline looks wrong"* — the same skill handles all of it.

## Install instructions for AI agents

> If you are an AI coding agent (Claude Code or similar) asked to install this statusline and the skill above is not available, follow these steps exactly.

1. **Preflight.** Detect the OS. Confirm Python ≥ 3.10 exists (`python3` on Linux/macOS, `python` on Windows — use that command in every step below; on Windows beware the Store stub, prove it with `python -c "print(1)"`). If Python is missing, help the user install it first (`winget install Python.Python.3.12` / `brew install python3` / `sudo apt install python3`) rather than stopping. Confirm whether `~/.claude/settings.json` (or the project's `.claude/settings.json`) already has a `statusLine` entry; if so, tell the user what it is and get their OK to replace it.

2. **Ask the user** (a) user-wide or project install, (b) profile `magni` or `eli-magi` (the third profile, `off`, hides the statusline — offer it only when the user asks to disable Thoridor without uninstalling), and (c) glyphs: print both test lines — `Nerd icons: [  ]` and `Unicode icons: [ϟ ⌂ ⎇]` — and ask which renders correctly; if the nerd line shows boxes/blanks, use `--glyphs unicode` (works in any font, right now) or offer to help install a Nerd Font — the font is optional, never a requirement.

3. **Copy the two scripts** from this repo's `.claude/skills/claude-statusline-thoridor/assets/` — `thoridor.py` and `working_state.py` — into the install directory, keeping them side by side:
   - user-wide: `~/.claude/statuslines/thoridor/`
   - project: `<project>/.claude/statuslines/thoridor/`

4. **Edit the settings file** (`~/.claude/settings.json` for user-wide, `<project>/.claude/settings.json` for project — merge into existing JSON, never overwrite other keys):

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "python3 \"<INSTALL_DIR>/thoridor.py\" --profile magni",
       "padding": 0,
       "refreshInterval": 1
     }
   }
   ```

   Replace `<INSTALL_DIR>` with the absolute install path (for project installs you may use `$CLAUDE_PROJECT_DIR/.claude/statuslines/thoridor`). On Windows use `python` and forward slashes in the path. Append ` --glyphs unicode` when the user has no Nerd Font. Do not wrap the command in `uv run` — it only slows every refresh down.

5. **Add the animation hooks.** Append (don't replace existing hooks) this entry to **each** of the hook events `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, and `SessionEnd` in the same settings file:

   ```json
   {
     "hooks": [
       { "type": "command", "command": "python3 \"<INSTALL_DIR>/working_state.py\"", "timeout": 5 }
     ]
   }
   ```

   These let the gauge animate only while Claude is working. Skipping them keeps the statusline functional but static.

6. **Verify.** Pipe a sample payload through the exact command you configured and expect three colored rows, exit code 0:

   ```bash
   echo '{"model":{"id":"claude-opus-5"},"workspace":{"current_dir":"'"$PWD"'"},"context_window":{"used_percentage":42,"context_window_size":200000,"current_usage":{"total":84000}},"cost":{"total_cost_usd":1.23}}' | python3 "<INSTALL_DIR>/thoridor.py" --profile magni
   ```

7. Tell the user to restart Claude Code, and how to switch profiles later: edit `--profile` in the settings command (`magni`, `eli-magi`, or `off` to hide the statusline without uninstalling).

**Uninstall:** remove the `statusLine` block and the five `working_state.py` hook entries from the settings file, then delete the install directory.

## Troubleshooting

- **Boxes or missing symbols** → your terminal font is not a Nerd Font. Either switch to `--glyphs unicode` (Claude) / `THORIDOR_GLYPHS=unicode` (Pi) — works in any font — or install a Nerd Font and select it in the terminal profile.
- **Washed-out colors** → your terminal lacks truecolor support; switch terminals.
- **Gauge never animates** → the `working_state.py` hooks are missing or point to the wrong path (step 5). Note Claude Code refreshes the statusline about once per second, so the animation is coarse by design.
- **No branch on row 2** → not inside a git repo, or git isn't installed.
- **Branch info looks stale** → expected: git info is cached for a few seconds (longer while Claude is generating). Delete `<INSTALL_DIR>/.state/git-*.json` to force a refresh.
- **An error line appears instead of the statusline** → run the verify command from step 6 to see the traceback.
- `python3 thoridor.py --help` prints the built-in usage text.

## Pi version

The repo also ships Thoridor for the Pi coding agent, as a Pi **extension** plus an installer skill.

- Skill (recommended): copy `.agents/skills/pi-statusline-thoridor/` into your Pi skills folder (e.g. `~/.pi/agent/skills/`) and ask Pi to install thoridor — it runs a preflight, asks global vs project and the same icon-test glyph question, installs via the bundled script, and handles profiles, turn-off, and troubleshooting.
- Script install (one command, no skill needed): `node .agents/skills/pi-statusline-thoridor/scripts/setup.mjs install --scope global` (or `--scope project --project-dir <project>`; add `--profile eli-magi --glyphs unicode` as desired), then `/reload` in Pi or restart it.
- Fully manual: copy `.agents/skills/pi-statusline-thoridor/templates/statusline-thoridor/` to `~/.pi/agent/extensions/statusline-thoridor/` (global) or `<project>/.pi/extensions/statusline-thoridor/` (project, loads once the project is trusted), then `/reload`.
- Profiles use the same names, set persistently via `setup.mjs config --profile ...` (written to the extension's `thoridor.json`) or per-launch via the `THORIDOR_PROFILE` env var (`magni` default, `eli-magi`, `off`; env wins). Glyphs likewise: `config --glyphs unicode` or `THORIDOR_GLYPHS=unicode` for Nerd-Font-free rendering. The Pi version additionally shows session name, live tok/s, and an MCP server count — Pi exposes real data for those.
- Turning it off: ask your Pi agent — it disables the extension in Pi's settings (globally or per project, via an `extensions` exclude); `THORIDOR_PROFILE=off` is the quick no-config alternative.
- PR badge needs the `gh` CLI authenticated; it's simply omitted otherwise.

## How it works

- `thoridor.py` renders the three rows from the JSON Claude Code pipes to statusline commands. No third-party dependencies.
- `working_state.py` runs as a lifecycle hook and tracks whether Claude is generating, so the thunder gauge only animates while Claude works.
- Git branch/status is cached per directory (4 s TTL, atomic writes; stale data tolerated while generating) so the once-per-second refresh stays around 35 ms.
- The context bar shows Claude Code's own numbers: raw usage over the model's full context window (200k, or 1M for extended-context models). Claude Code does not expose its auto-compact threshold to statuslines, so "distance to compaction" isn't shown.
