#!/usr/bin/env python3
"""Track Claude's working state per session for the animated statusline."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

STATE_DIR = Path(__file__).resolve().parent / ".state"
WORKING_EVENTS = {"UserPromptSubmit"}
IDLE_EVENTS = {"SessionStart", "Stop", "StopFailure"}
MAX_WORKING_AGE_SECONDS = 12 * 60 * 60


def state_path(session_id: str) -> Path:
    key = hashlib.sha256(session_id.encode("utf-8")).hexdigest()
    return STATE_DIR / f"{key}.json"


def is_working(session_id: str | None) -> bool:
    if not session_id:
        return False
    try:
        state = json.loads(state_path(session_id).read_text(encoding="utf-8"))
        updated_at = float(state.get("updated_at") or 0)
        return state.get("working") is True and time.time() - updated_at < MAX_WORKING_AGE_SECONDS
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return False


def write_state(session_id: str, working: bool) -> None:
    STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = state_path(session_id)
    temporary = destination.with_suffix(f".{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps({"working": working, "updated_at": time.time()}),
        encoding="utf-8",
    )
    os.chmod(temporary, 0o600)
    temporary.replace(destination)


def handle_hook(input_data: dict[str, Any]) -> None:
    session_id = input_data.get("session_id")
    event = input_data.get("hook_event_name")
    if not isinstance(session_id, str) or not session_id:
        return
    path = state_path(session_id)
    if event == "SessionEnd":
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    elif event in WORKING_EVENTS:
        write_state(session_id, True)
    elif event in IDLE_EVENTS:
        write_state(session_id, False)


def main() -> None:
    try:
        input_data = json.load(sys.stdin)
        if isinstance(input_data, dict):
            handle_hook(input_data)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        # Status tracking must never interfere with Claude's hook lifecycle.
        pass


if __name__ == "__main__":
    main()
