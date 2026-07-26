#!/usr/bin/env python3
"""Deterministic installer/manager for the Thoridor Claude Code statusline.

Run from the skill directory (the script locates the bundled assets itself).

Commands:
  check      [--project-dir DIR]              preflight report (read-only)
  install    --scope user|project [--profile magni|eli-magi] [--project-dir DIR]
  set-profile --scope user|project --profile magni|eli-magi|off [--project-dir DIR]
  uninstall  --scope user|project [--project-dir DIR]
  verify     --scope user|project [--project-dir DIR]

Exit codes: 0 success, 1 failure, 2 usage error.
All settings.json edits are merges (other keys untouched) with atomic writes.
Every command prints a JSON result on the last line for machine reading.
"""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = SKILL_DIR / "assets"
ASSET_FILES = ("thoridor.py", "working_state.py")
HOOK_EVENTS = ("SessionStart", "UserPromptSubmit", "Stop", "StopFailure", "SessionEnd")
PROFILES = ("magni", "eli-magi", "off")
SAMPLE_PAYLOAD = json.dumps(
    {
        "model": {"id": "claude-opus-5"},
        "workspace": {"current_dir": str(Path.home())},
        "context_window": {
            "used_percentage": 42,
            "context_window_size": 200000,
            "current_usage": {"total": 84000},
        },
        "cost": {"total_cost_usd": 1.23},
    }
)


def fail(message: str, code: int = 1) -> "NoReturn":  # noqa: F821
    print(json.dumps({"ok": False, "error": message}))
    raise SystemExit(code)


def python_command() -> str:
    return "python" if platform.system() == "Windows" else "python3"


def resolve_paths(scope: str, project_dir: str | None, home: str | None) -> tuple[Path, Path]:
    """Return (install_dir, settings_path) for the scope."""
    if scope == "user":
        base = Path(home).expanduser() if home else Path.home()
        claude_dir = base / ".claude"
    else:
        if not project_dir:
            fail("--project-dir is required for --scope project", 2)
        claude_dir = Path(project_dir).resolve() / ".claude"
    return claude_dir / "statuslines" / "thoridor", claude_dir / "settings.json"


def load_settings(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"cannot parse {path}: {error} — fix or back up the file first")
    if not isinstance(data, dict):
        fail(f"{path} does not contain a JSON object")
    return data


def save_settings(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def statusline_command(install_dir: Path, profile: str, glyphs: str = "nerd") -> str:
    command = f'{python_command()} "{install_dir / "thoridor.py"}" --profile {profile}'
    if glyphs != "nerd":
        command += f" --glyphs {glyphs}"
    return command


def hook_command(install_dir: Path) -> str:
    return f'{python_command()} "{install_dir / "working_state.py"}"'


def is_thoridor_statusline(entry) -> bool:
    return isinstance(entry, dict) and "thoridor.py" in str(entry.get("command", ""))


def is_thoridor_hook(hook) -> bool:
    return isinstance(hook, dict) and "working_state.py" in str(hook.get("command", ""))


def merge_hooks(settings: dict, install_dir: Path) -> None:
    """Idempotently ensure one thoridor hook per lifecycle event."""
    command = hook_command(install_dir)
    hooks = settings.setdefault("hooks", {})
    for event in HOOK_EVENTS:
        groups = hooks.setdefault(event, [])
        placed = False
        for group in groups:
            entries = group.get("hooks", []) if isinstance(group, dict) else []
            for entry in entries:
                if is_thoridor_hook(entry):
                    entry["command"] = command
                    entry.setdefault("timeout", 5)
                    placed = True
        if not placed:
            groups.append({"hooks": [{"type": "command", "command": command, "timeout": 5}]})


def remove_hooks(settings: dict) -> int:
    removed = 0
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return 0
    for event in list(hooks):
        groups = hooks[event]
        if not isinstance(groups, list):
            continue
        for group in groups:
            if isinstance(group, dict) and isinstance(group.get("hooks"), list):
                before = len(group["hooks"])
                group["hooks"] = [h for h in group["hooks"] if not is_thoridor_hook(h)]
                removed += before - len(group["hooks"])
        hooks[event] = [
            g for g in groups
            if not (isinstance(g, dict) and g.get("hooks") == [] and set(g) <= {"hooks", "matcher"})
        ]
        if hooks[event] == []:
            del hooks[event]
    if hooks == {}:
        del settings["hooks"]
    return removed


def run_verify(settings_path: Path) -> dict:
    settings = load_settings(settings_path)
    entry = settings.get("statusLine")
    if not is_thoridor_statusline(entry):
        return {"ok": False, "error": f"no thoridor statusLine configured in {settings_path}"}
    try:
        result = subprocess.run(
            entry["command"],
            shell=True,
            input=SAMPLE_PAYLOAD,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (subprocess.TimeoutExpired, OSError) as error:
        return {"ok": False, "error": f"statusline command failed to run: {error}"}
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    profile = extract_profile(entry["command"])
    expected = 0 if profile == "off" else 3
    ok = result.returncode == 0 and len(lines) == expected
    return {
        "ok": ok,
        "exit_code": result.returncode,
        "rows": len(lines),
        "expected_rows": expected,
        "profile": profile,
        **({} if ok else {"stderr": result.stderr[-400:]}),
    }


def extract_profile(command: str) -> str:
    match = re.search(r"--profile[= ]([\w-]+)", command)
    return match.group(1) if match else "magni"


def extract_glyphs(command: str) -> str:
    match = re.search(r"--glyphs[= ]([\w-]+)", command)
    return match.group(1) if match else "nerd"


def set_command_flag(command: str, flag: str, value: str, default: str) -> str:
    """Deterministically set --<flag> <value> in a statusline command string."""
    stripped = re.sub(rf" ?--{flag}[= ][\w-]+", "", command)
    return stripped if value == default else f"{stripped} --{flag} {value}"


def cmd_check(args) -> dict:
    report: dict = {
        "ok": True,
        "platform": platform.system(),
        "python": platform.python_version(),
        "python_ok": sys.version_info >= (3, 10),
        "git": shutil.which("git") is not None,
        "scopes": {},
    }
    scopes = [("user", None)]
    if args.project_dir:
        scopes.append(("project", args.project_dir))
    for scope, project_dir in scopes:
        install_dir, settings_path = resolve_paths(scope, project_dir, args.home)
        settings = load_settings(settings_path)
        entry = settings.get("statusLine")
        report["scopes"][scope] = {
            "install_dir": str(install_dir),
            "installed": (install_dir / "thoridor.py").exists(),
            "settings": str(settings_path),
            "statusline_configured": entry is not None,
            "statusline_is_thoridor": is_thoridor_statusline(entry),
            "statusline_command": (entry or {}).get("command") if isinstance(entry, dict) else None,
            "profile": extract_profile(entry["command"]) if is_thoridor_statusline(entry) else None,
            "glyphs": extract_glyphs(entry["command"]) if is_thoridor_statusline(entry) else None,
        }
    return report


def cmd_install(args) -> dict:
    if not sys.version_info >= (3, 10):
        fail(f"Python >= 3.10 required, found {platform.python_version()}")
    for name in ASSET_FILES:
        if not (ASSETS_DIR / name).exists():
            fail(f"missing skill asset: {ASSETS_DIR / name}")
    install_dir, settings_path = resolve_paths(args.scope, args.project_dir, args.home)
    settings = load_settings(settings_path)
    existing = settings.get("statusLine")
    if existing is not None and not is_thoridor_statusline(existing) and not args.force:
        fail(
            f"a non-thoridor statusLine exists in {settings_path}: "
            f"{json.dumps(existing)} — rerun with --force to replace it"
        )
    install_dir.mkdir(parents=True, exist_ok=True)
    for name in ASSET_FILES:
        shutil.copy2(ASSETS_DIR / name, install_dir / name)
    settings["statusLine"] = {
        "type": "command",
        "command": statusline_command(install_dir, args.profile, args.glyphs),
        "padding": 0,
        "refreshInterval": 1,
    }
    merge_hooks(settings, install_dir)
    save_settings(settings_path, settings)
    verify = run_verify(settings_path)
    return {
        "ok": bool(verify.get("ok")),
        "action": "install",
        "scope": args.scope,
        "profile": args.profile,
        "install_dir": str(install_dir),
        "settings": str(settings_path),
        "verify": verify,
    }


def cmd_set_profile(args) -> dict:
    install_dir, settings_path = resolve_paths(args.scope, args.project_dir, args.home)
    settings = load_settings(settings_path)
    entry = settings.get("statusLine")
    if not is_thoridor_statusline(entry):
        if args.scope == "project" and (args.profile == "off" or args.allow_new):
            # Project override (e.g. project off while the user install stays on).
            user_install = Path.home() / ".claude" / "statuslines" / "thoridor"
            target = install_dir if (install_dir / "thoridor.py").exists() else user_install
            settings["statusLine"] = {
                "type": "command",
                "command": statusline_command(target, args.profile),
                "padding": 0,
                "refreshInterval": 1,
            }
        else:
            fail(f"no thoridor statusLine in {settings_path} — install first")
    else:
        command = entry["command"]
        if re.search(r"--profile[= ][\w-]+", command):
            command = re.sub(r"(--profile[= ])[\w-]+", rf"\g<1>{args.profile}", command)
        else:
            command += f" --profile {args.profile}"
        entry["command"] = command
    save_settings(settings_path, settings)
    return {
        "ok": True,
        "action": "set-profile",
        "scope": args.scope,
        "profile": args.profile,
        "settings": str(settings_path),
        "command": settings["statusLine"]["command"],
    }


def cmd_set_glyphs(args) -> dict:
    _, settings_path = resolve_paths(args.scope, args.project_dir, args.home)
    settings = load_settings(settings_path)
    entry = settings.get("statusLine")
    if not is_thoridor_statusline(entry):
        fail(f"no thoridor statusLine in {settings_path} — install first")
    entry["command"] = set_command_flag(entry["command"], "glyphs", args.glyphs, "nerd")
    save_settings(settings_path, settings)
    return {
        "ok": True,
        "action": "set-glyphs",
        "scope": args.scope,
        "glyphs": args.glyphs,
        "command": entry["command"],
    }


def cmd_uninstall(args) -> dict:
    install_dir, settings_path = resolve_paths(args.scope, args.project_dir, args.home)
    settings = load_settings(settings_path)
    removed_statusline = False
    if is_thoridor_statusline(settings.get("statusLine")):
        del settings["statusLine"]
        removed_statusline = True
    removed_hooks = remove_hooks(settings)
    if removed_statusline or removed_hooks:
        save_settings(settings_path, settings)
    removed_files = install_dir.exists()
    if removed_files:
        shutil.rmtree(install_dir)
    return {
        "ok": True,
        "action": "uninstall",
        "scope": args.scope,
        "removed_statusline": removed_statusline,
        "removed_hooks": removed_hooks,
        "removed_files": removed_files,
    }


def cmd_verify(args) -> dict:
    _, settings_path = resolve_paths(args.scope, args.project_dir, args.home)
    return run_verify(settings_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["check", "install", "set-profile", "set-glyphs", "uninstall", "verify"])
    parser.add_argument("--scope", choices=["user", "project"])
    parser.add_argument("--profile", choices=PROFILES, default="magni")
    parser.add_argument("--glyphs", choices=["nerd", "unicode"], default="nerd")
    parser.add_argument("--project-dir")
    parser.add_argument("--home", help="override home directory (for tests)")
    parser.add_argument("--force", action="store_true", help="replace a non-thoridor statusLine")
    parser.add_argument("--allow-new", action="store_true", help="set-profile may create a project override entry")
    args = parser.parse_args()

    if args.command != "check" and not args.scope:
        fail(f"--scope is required for {args.command}", 2)

    handler = {
        "check": cmd_check,
        "install": cmd_install,
        "set-profile": cmd_set_profile,
        "set-glyphs": cmd_set_glyphs,
        "uninstall": cmd_uninstall,
        "verify": cmd_verify,
    }[args.command]
    result = handler(args)
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
