# statusline-thoridor

A portable, three-row animated statusline for [Claude Code](https://claude.com/claude-code), packaged as a Claude Code **skill** that installs and configures itself.

```
 anthropic/claude-opus-5  xhigh
  \~/dev/my-project ·  main · 3 changed · PR#42
 ϟϟϟϟϟϟϟϟϟϟϟ··············· 42% (84k/200k)                                $1.23
```

1. **Identity** — provider/model and thinking effort.
2. **Location** — directory, git branch, changed-file count, and PR (separators in Rosé Pine gold).
3. **Context** — a 26-cell thunder gauge of context usage that *animates while Claude is working*, plus percentage, tokens, and session cost.

Two color profiles:

| Profile | Row 1 (model/effort) | Row 2 (dir/git) |
|---|---|---|
| `magni` (default) | blue | red |
| `eli-magi` | red | blue |

## Install

Copy the skill into your Claude Code skills folder:

```bash
# user-wide
git clone https://github.com/rhicnl/statusline-thoridor
mkdir -p ~/.claude/skills
cp -r statusline-thoridor/.claude/skills/statusline-thoridor ~/.claude/skills/
```

(or clone straight into a project — the skill already lives at `.claude/skills/statusline-thoridor/`, so it's picked up there automatically.)

Then start Claude Code and say:

```
/statusline-thoridor install
```

The skill runs preflight checks (OS, Python ≥ 3.10, git, existing statusline config), asks whether to install user-wide or per-project and which profile you want, copies the files, wires up `settings.json` (statusline command + the lifecycle hooks that drive the animation), and verifies the result. Works on Linux, macOS, and Windows.

It also handles `switch profile`, `uninstall`, and troubleshooting — just ask.

## Requirements

- Python 3.10+
- A truecolor terminal (Windows Terminal, iTerm2, kitty, Ghostty, …)
- A [Nerd Font](https://www.nerdfonts.com/) for the lightning/folder/branch glyphs

## How it works

- `assets/thoridor.py` renders the three rows from the JSON Claude Code pipes to statusline commands (`--help` for details). No third-party dependencies.
- `assets/working_state.py` runs as a lifecycle hook (SessionStart / UserPromptSubmit / Stop / StopFailure / SessionEnd) and tracks whether Claude is generating, so the thunder gauge only animates while Claude works.
- Git branch/status is cached per directory (4 s TTL, atomically written; stale data tolerated while generating) so the once-per-second refresh stays ~35 ms.

The context bar shows Claude Code's own numbers: raw usage over the model's full context window (200k, or 1M for extended-context models). Claude Code does not expose its auto-compact threshold to statuslines, so "distance to compaction" isn't shown.

## Credits

A Claude Code port of the Thoridor statusline from [Pi](https://github.com/badlogic/pi-mono), colors from [Rosé Pine Moon](https://rosepinetheme.com/palette/) (see `assets/rose-pine-moon.md`).
