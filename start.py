#!/usr/bin/env python3
"""
Redline - development launcher.

Starts the FastAPI backend (http://127.0.0.1:8100) and the Vite frontend
(http://127.0.0.1:5173). Installs missing dependencies on first run, never starts
a second copy of anything already running, and restarts the backend when files in
backend/app or ai/ change.

    python start.py
    python start.py --api-only

Backend reloads are done here rather than with `uvicorn --reload`: on Windows its
reloader stops the worker with a Ctrl+C signal, which never arrives when the server
isn't attached to a console (IDE terminals, background launches), so the old code
kept running. Restarting the whole process tree works everywhere.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
WATCH_DIRS = [BACKEND / "app", ROOT / "ai"]  # a change in either restarts the API
WATCH_SUFFIXES = {".py", ".md", ".json"}
WINDOWS = sys.platform == "win32"
FRONTEND_PORT = 5173


def venv_python() -> Path:
    return BACKEND / ".venv" / ("Scripts/python.exe" if WINDOWS else "bin/python")


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def is_redline_api(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=2) as r:
            return json.load(r).get("service") in ("redline", "resume-tailor")  # pre-rename backends too
    except Exception:
        return False


def ensure_backend() -> None:
    if not venv_python().exists():
        print("Creating backend virtualenv...", flush=True)
        subprocess.check_call([sys.executable, "-m", "venv", str(BACKEND / ".venv")])
        subprocess.check_call([str(venv_python()), "-m", "pip", "install", "-r", "requirements.txt"], cwd=BACKEND)


def ensure_frontend() -> None:
    if not (FRONTEND / "node_modules").exists():
        print("Installing frontend dependencies...", flush=True)
        subprocess.check_call(["npm", "install"], cwd=FRONTEND, shell=WINDOWS)


def kill_tree(proc: subprocess.Popen) -> None:
    """Stop a process and everything it started (venv launchers and npm spawn children)."""
    if proc.poll() is not None:
        return
    if WINDOWS:
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def start_backend(port: int) -> subprocess.Popen:
    # The backend imports `app` (from backend/) and `ai` (from the project root).
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(ROOT), os.environ.get("PYTHONPATH", "")]))}
    return subprocess.Popen(
        [str(venv_python()), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
        cwd=BACKEND,
        env=env,
    )


def snapshot() -> dict[Path, int]:
    return {
        f: f.stat().st_mtime_ns
        for folder in WATCH_DIRS
        for f in folder.rglob("*")
        if f.suffix in WATCH_SUFFIXES and "__pycache__" not in f.parts and "tests" not in f.parts
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Redline locally")
    parser.add_argument("--api-only", action="store_true", help="start the backend only")
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8100")))
    args = parser.parse_args()

    backend: subprocess.Popen | None = None
    frontend: subprocess.Popen | None = None

    # A duplicate backend would fight over the port; a duplicate frontend would
    # silently move to another port - so reuse whatever is already running.
    if port_in_use(args.port):
        if not is_redline_api(args.port):
            sys.exit(f"Port {args.port} is used by another program. Stop it, or run: python start.py --port <free port>")
        print(f"\n  API       : already running - http://127.0.0.1:{args.port}/docs", flush=True)
    else:
        ensure_backend()
        backend = start_backend(args.port)
        print(f"\n  API       : http://127.0.0.1:{args.port}/docs  (restarts when backend/app or ai/ changes)", flush=True)

    if not args.api_only:
        if port_in_use(FRONTEND_PORT):
            print(f"  Frontend  : already running - http://127.0.0.1:{FRONTEND_PORT}/", flush=True)
        else:
            if not shutil.which("node"):
                sys.exit("Node.js is required for the frontend.")
            ensure_frontend()
            env = {**os.environ, "VITE_API_URL": f"http://127.0.0.1:{args.port}"}
            frontend = subprocess.Popen(
                ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(FRONTEND_PORT), "--strictPort"],
                cwd=FRONTEND, env=env, shell=WINDOWS,
            )
            print(f"  Frontend  : http://127.0.0.1:{FRONTEND_PORT}/", flush=True)

    if backend is None and frontend is None:
        print("\n  Redline is already running - nothing to start.", flush=True)
        return
    print("\n  Press Ctrl+C to stop.\n", flush=True)

    watched = snapshot() if backend else {}
    backend_down_reported = False
    try:
        while True:
            time.sleep(1)
            if frontend is not None and frontend.poll() is not None:
                print(f"\n  Frontend exited (code {frontend.returncode}) - stopping.", flush=True)
                return
            if backend is None:
                continue

            # A crash (e.g. a syntax error mid-edit) shouldn't take the frontend down:
            # report it once and wait for the next change to restart.
            if backend.poll() is not None and not backend_down_reported:
                print("\n  Backend stopped - fix the error; it restarts on your next save.\n", flush=True)
                backend_down_reported = True

            current = snapshot()
            if current != watched:
                watched = current
                print("\n  Backend files changed - restarting API...", flush=True)
                kill_tree(backend)
                for _ in range(50):  # wait for the port to be released
                    if not port_in_use(args.port):
                        break
                    time.sleep(0.1)
                backend = start_backend(args.port)
                backend_down_reported = False
    except KeyboardInterrupt:
        pass
    finally:
        for proc in (backend, frontend):
            if proc is not None:
                kill_tree(proc)


if __name__ == "__main__":
    main()
