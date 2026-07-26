#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Thoridor — a three-row animated statusline for Claude Code.

Row 1: provider/model and thinking effort
Row 2: working directory, branch, changed files, and pull request
Row 3: randomized thunder gauge, percentage, tokens, and cost

Profiles (pick with --profile or the THORIDOR_PROFILE env var):
  magni     row 1 blue, row 2 red   (default)
  eli-magi  row 1 red,  row 2 blue

Run `thoridor.py --help` for usage and installation notes.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from working_state import is_working


HELP_TEXT = """\
Thoridor statusline for Claude Code

Usage:
  Claude Code pipes statusline JSON into this script on stdin; you normally
  never run it by hand. Wire it up in settings.json:

    {
      "statusLine": {
        "type": "command",
        "command": "python3 \\"<install-dir>/thoridor.py\\" --profile magni",
        "padding": 0,
        "refreshInterval": 1
      }
    }

  Use ~/.claude/settings.json for a user-wide install, or
  <project>/.claude/settings.json for a per-project install.

Options:
  --profile NAME   Color profile: magni (blue row 1, red row 2 — default)
                   or eli-magi (red row 1, blue row 2).
                   The THORIDOR_PROFILE env var works too; the flag wins.
  -h, --help       Show this help.

The animated gauge needs the bundled working_state.py registered as a hook
on SessionStart / UserPromptSubmit / Stop / StopFailure / SessionEnd —
without it the gauge still renders, just never animates.

  Prefer direct python3/python over `uv run` — the script has no third-party
  dependencies, and skipping uv saves ~40 ms per refresh.

Requires: Python 3.10+, a truecolor terminal, and a Nerd Font.
Manual test:
  echo '{"model":{"id":"claude-opus-5"},"context_window":{"used_percentage":42,"context_window_size":200000,"current_usage":{"total":84000}}}' | python3 thoridor.py
"""

# Rosé Pine Moon palette.
LOVE = "\033[38;2;235;111;146m"
GOLD = "\033[38;2;246;193;119m"
FOAM = "\033[38;2;156;207;216m"
IRIS = "\033[38;2;196;167;231m"
ROSE = "\033[38;2;234;154;151m"
MUTED = "\033[38;2;110;106;134m"
SUBTLE = "\033[38;2;144;140;170m"
RESET = "\033[0m"

BAR_WIDTH = 26
THUNDER_ICON = chr(0xF0E7)
UNUSED_ICON = "·"
DIR_ICON = chr(0xF07B)
BRANCH_ICON = chr(0xE0A0)
ANIMATION_INTERVAL_MS = 120
THORIDOR_CONTEXT_BAR_COLOR = "#ffff1a"
THORIDOR_CONTEXT_TEXT_COLOR = "#b3b312"
THUNDER_FLASH_COLOR = "#ffff66"

# Color profiles: "model"/"thinking" style row 1, "folder" styles row 2.
PROFILES = {
    "magni": {"model": "#3333ff", "thinking": "#0000ff", "folder": "#ff0000"},
    "eli-magi": {"model": "#ff0000", "thinking": "#cc0000", "folder": "#3333ff"},
}
DEFAULT_PROFILE = "magni"

THUNDER_STRIKE_FRAMES = (
    {"glyph": UNUSED_ICON, "intensity": 0.25, "flash": 0.0, "emphasis": "dim"},
    {"glyph": "ϟ", "intensity": 0.7, "flash": 0.45, "emphasis": "normal"},
    {"glyph": THUNDER_ICON, "intensity": 1.0, "flash": 1.0, "emphasis": "bold"},
    {"glyph": "ϟ", "intensity": 0.7, "flash": 0.45, "emphasis": "normal"},
    {"glyph": UNUSED_ICON, "intensity": 0.25, "flash": 0.0, "emphasis": "dim"},
)
MIN_STRIKE_CYCLE_FRAMES = 9
STRIKE_CYCLE_VARIANCE = 9
MIN_STRIKE_SPEED_PERCENT = 30
STRIKE_SPEED_VARIANCE = 70
ANSI_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))")


def resolve_profile(argv: list[str]) -> dict[str, str]:
    name = os.environ.get("THORIDOR_PROFILE", "")
    for index, arg in enumerate(argv):
        if arg == "--profile" and index + 1 < len(argv):
            name = argv[index + 1]
        elif arg.startswith("--profile="):
            name = arg.split("=", 1)[1]
    name = name.strip().lower() or DEFAULT_PROFILE
    return PROFILES.get(name, PROFILES[DEFAULT_PROFILE])


def color(code: str, text: str) -> str:
    return f"{code}{text}{RESET}"


def visible_width(text: str) -> int:
    return len(ANSI_RE.sub("", text))


def truncate_to_width(text: str, width: int, ellipsis: str = "...") -> str:
    """ANSI-aware truncation for statusline rows."""
    if width <= 0:
        return ""
    if visible_width(text) <= width:
        return text
    target = max(0, width - len(ellipsis))
    output: list[str] = []
    visible = 0
    index = 0
    hyperlink_open = False
    while index < len(text) and visible < target:
        match = ANSI_RE.match(text, index)
        if match:
            sequence = match.group(0)
            output.append(sequence)
            if sequence.startswith("\033]8;;"):
                hyperlink_open = sequence not in ("\033]8;;\033\\", "\033]8;;\007")
            index = match.end()
            continue
        output.append(text[index])
        visible += 1
        index += 1
    if hyperlink_open:
        output.append("\033]8;;\033\\")
    output.append(RESET)
    output.append(ellipsis)
    return "".join(output)


def format_cwd(cwd: str) -> str:
    if not cwd:
        return "unknown"
    home = Path.home()
    path = Path(cwd)
    try:
        relative = path.resolve().relative_to(home.resolve())
    except (OSError, ValueError):
        return str(path)
    return "~" if str(relative) == "." else f"~/{relative.as_posix()}"


def run_git(directory: str, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", directory, *args],
            capture_output=True,
            text=True,
            timeout=3,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""


def get_git_info(directory: str) -> tuple[str, int]:
    branch = run_git(directory, "branch", "--show-current")
    if not branch:
        head = run_git(directory, "rev-parse", "--short", "HEAD")
        branch = f"detached@{head}" if head else ""
    status = run_git(directory, "status", "--porcelain=v1", "--untracked-files=all")
    changed_files = len(status.splitlines()) if status else 0
    return branch, changed_files


STATE_DIR = Path(__file__).resolve().parent / ".state"
GIT_CACHE_TTL_SECONDS = 4.0
GIT_CACHE_GENERATING_TTL_SECONDS = 300.0


def get_git_info_cached(directory: str, generating: bool) -> tuple[str, int]:
    """File-backed git cache: the statusline process exits after every render,
    so in-process memoization is useless. Fresh git data matters when idle;
    while generating, stale details are acceptable and the animation should
    not pay for git subprocesses every refresh."""
    key = hashlib.sha256(str(Path(directory).resolve()).encode("utf-8")).hexdigest()[:32]
    cache_file = STATE_DIR / f"git-{key}.json"
    try:
        cached = json.loads(cache_file.read_text(encoding="utf-8"))
        age = time.time() - float(cached["at"])
        ttl = GIT_CACHE_GENERATING_TTL_SECONDS if generating else GIT_CACHE_TTL_SECONDS
        if 0 <= age < ttl:
            return str(cached["branch"]), int(cached["changed"])
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        pass
    branch, changed_files = get_git_info(directory)
    try:
        STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = cache_file.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(
            json.dumps({"at": time.time(), "branch": branch, "changed": changed_files}),
            encoding="utf-8",
        )
        temporary.replace(cache_file)
    except OSError:
        pass
    return branch, changed_files


def format_tokens(count: int) -> str:
    if count >= 1_000_000:
        return f"{count / 1_000_000:.1f}M"
    if count >= 1_000:
        return f"{round(count / 1_000)}k"
    return str(count)


def get_context_data(input_data: dict[str, Any]) -> tuple[int, int, int]:
    context = input_data.get("context_window") or {}
    current_usage = context.get("current_usage") or {}
    current = current_usage.get("total")
    if current is None:
        current = sum(
            int(current_usage.get(field) or 0)
            for field in (
                "input_tokens",
                "cache_creation_input_tokens",
                "cache_read_input_tokens",
            )
        )

    context_window = int(context.get("context_window_size") or 0)
    documented_percentage = context.get("used_percentage")
    if documented_percentage is not None:
        percentage = round(float(documented_percentage))
    elif context_window > 0:
        percentage = round(current * 100 / context_window)
    else:
        percentage = 0
    return max(0, min(100, percentage)), max(0, int(current)), context_window


def hex_ansi(hex_color: str) -> str:
    red = int(hex_color[1:3], 16)
    green = int(hex_color[3:5], 16)
    blue = int(hex_color[5:7], 16)
    return f"\033[38;2;{red};{green};{blue}m"


def mix_hex(start: str, end: str, amount: float) -> str:
    channels = []
    for offset in (1, 3, 5):
        start_channel = int(start[offset : offset + 2], 16)
        end_channel = int(end[offset : offset + 2], 16)
        channels.append(round(start_channel + (end_channel - start_channel) * amount))
    return "#" + "".join(f"{channel:02x}" for channel in channels)


def thunder_hash(value: int) -> int:
    value = ((value ^ 0x9E3779B9) * 0x85EBCA6B) & 0xFFFFFFFF
    value = ((value ^ (value >> 13)) * 0xC2B2AE35) & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFFFFFFFF


def get_thunder_strike_frame(cell_index: int, phase: int) -> dict[str, Any]:
    cycle_length = MIN_STRIKE_CYCLE_FRAMES + thunder_hash(cell_index + 1) % STRIKE_CYCLE_VARIANCE
    offset = thunder_hash(cell_index + 101) % cycle_length
    speed_percent = MIN_STRIKE_SPEED_PERCENT + thunder_hash(cell_index + 211) % (STRIKE_SPEED_VARIANCE + 1)
    cell_phase = int(phase * (speed_percent / 100))
    cycle_frame = (cell_phase + offset) % cycle_length
    return THUNDER_STRIKE_FRAMES[cycle_frame] if cycle_frame < len(THUNDER_STRIKE_FRAMES) else THUNDER_STRIKE_FRAMES[0]


def render_thunder_strike_cell(cell_index: int, phase: int, fill_color: str) -> str:
    frame = get_thunder_strike_frame(cell_index, phase)
    charged_color = mix_hex("#6e6a86", fill_color, float(frame["intensity"]))
    strike_color = mix_hex(charged_color, THUNDER_FLASH_COLOR, float(frame["flash"]))
    emphasis = frame["emphasis"]
    emphasis_start = "\033[1m" if emphasis == "bold" else "\033[2m" if emphasis == "dim" else ""
    emphasis_end = "\033[22m" if emphasis_start else ""
    return color(hex_ansi(strike_color), f"{emphasis_start}{frame['glyph']}{emphasis_end}")


def create_progress_bar(percentage: int, fill_color: str) -> str:
    filled = min(BAR_WIDTH, round((percentage / 100) * BAR_WIDTH))
    empty = BAR_WIDTH - filled
    return f"{color(hex_ansi(fill_color), THUNDER_ICON * filled)}{color(SUBTLE, UNUSED_ICON * empty)}"


def create_animated_progress_bar(percentage: int, fill_color: str, phase: int) -> str:
    """Render independently randomized thunder strikes across used cells."""
    filled = min(BAR_WIDTH, round((percentage / 100) * BAR_WIDTH))
    used = "".join(
        render_thunder_strike_cell(cell_index, phase, fill_color)
        for cell_index in range(filled)
    )
    return f"{used}{color(SUBTLE, UNUSED_ICON * (BAR_WIDTH - filled))}"


def format_pr(input_data: dict[str, Any]) -> str:
    pr = input_data.get("pr") or {}
    number = pr.get("number")
    if not number:
        return ""
    label = f"PR#{number}"
    url = pr.get("url")
    linked = f"\033]8;;{url}\033\\{label}\033]8;;\033\\" if url else label
    return f"{linked} draft" if pr.get("isDraft") is True else linked


def align_right(left: str, right: str, width: int) -> str:
    """Right-align `right` on the same line as `left`, clipping the left side."""
    if not right:
        return truncate_to_width(left, width)
    right_width = visible_width(right)
    if right_width >= width:
        return truncate_to_width(right, width, "")
    if visible_width(left) + 1 + right_width <= width:
        return f"{left}{' ' * (width - visible_width(left) - right_width)}{right}"
    clipped_left = truncate_to_width(left, width - right_width - 1)
    gap = max(1, width - visible_width(clipped_left) - right_width)
    return f"{clipped_left}{' ' * gap}{right}"


def generate_status_line(input_data: dict[str, Any], profile: dict[str, str]) -> str:
    terminal_width = shutil.get_terminal_size(fallback=(120, 0)).columns
    content_width = max(0, terminal_width - 3)
    workspace = input_data.get("workspace") or {}
    current_dir = workspace.get("current_dir") or input_data.get("cwd") or ""

    model = input_data.get("model") or {}
    model_id = model.get("id") or model.get("display_name") or "unknown"
    provider_model = model_id if "/" in model_id else f"anthropic/{model_id}"
    effort = (input_data.get("effort") or {}).get("level")

    row1_parts = [color(hex_ansi(profile["model"]), provider_model)]
    if effort:
        row1_parts.append(color(hex_ansi(profile["thinking"]), str(effort)))
    row1 = truncate_to_width(f" {'  '.join(row1_parts)}", content_width)

    # Claude does not expose a live "generating" flag, so lifecycle hooks
    # maintain equivalent per-session working state.
    generating = is_working(input_data.get("session_id"))

    directory_part = color(hex_ansi(profile["folder"]), f"{DIR_ICON} \\{format_cwd(current_dir)}")
    row2 = f" {directory_part}"
    branch, changed_files = get_git_info_cached(current_dir, generating) if current_dir else ("", 0)
    if branch:
        git_text = f"{BRANCH_ICON} {branch}"
        if changed_files > 0:
            git_text += f" · {changed_files} changed"
        pr = format_pr(input_data)
        if pr:
            git_text += f" · {pr}"
        row2 += color(GOLD, " · ") + color(hex_ansi(profile["folder"]), git_text)
    row2 = truncate_to_width(row2, content_width)

    percentage, current_tokens, context_window = get_context_data(input_data)
    bar_color = THORIDOR_CONTEXT_BAR_COLOR
    phase = int(time.time() * 1000 / ANIMATION_INTERVAL_MS)
    progress = (
        create_animated_progress_bar(percentage, bar_color, phase)
        if generating
        else create_progress_bar(percentage, bar_color)
    )
    context_label = format_tokens(context_window) if context_window > 0 else "?"
    context_text_color = hex_ansi(THORIDOR_CONTEXT_TEXT_COLOR)
    row3_left = (
        f" {progress} {color(context_text_color, f'{percentage}%')} "
        f"{color(context_text_color, f'({format_tokens(current_tokens)}/{context_label})')}"
    )

    cost = float((input_data.get("cost") or {}).get("total_cost_usd") or 0)
    row3 = align_right(
        row3_left,
        color(context_text_color, f"${cost:.2f}"),
        content_width,
    )

    return "\n".join((row1, row2, row3))


def main() -> None:
    if any(arg in ("-h", "--help") for arg in sys.argv[1:]):
        print(HELP_TEXT)
        return
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    profile = resolve_profile(sys.argv[1:])
    try:
        input_text = sys.stdin.read()
        input_data = json.loads(input_text) if input_text.strip() else {}
        print(generate_status_line(input_data, profile))
    except Exception as error:
        print(color(LOVE, f"Error: {error}"))
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
