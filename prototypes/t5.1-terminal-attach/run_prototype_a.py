"""Verification runner launching DaemonPtyServer and exercising ClientAttach."""

from __future__ import annotations

import os
import subprocess
import sys
import time


def main() -> None:
    """Run daemon PTY server and verify client interactions."""
    server_path = os.path.join(os.path.dirname(__file__), "daemon_pty_server.py")
    client_path = os.path.join(os.path.dirname(__file__), "client_attach.py")

    proc = subprocess.Popen(
        [sys.executable, server_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    time.sleep(0.5)

    try:
        client_res = subprocess.run(
            [sys.executable, client_path], capture_output=True, text=True, check=False
        )
        if client_res.returncode != 0:
            print("[Client Error]:", client_res.stderr)
            raise RuntimeError(f"Client failed with status {client_res.returncode}")
        print(client_res.stdout.strip())
    finally:
        proc.terminate()
        try:
            proc.communicate(timeout=2.0)
        except (subprocess.TimeoutExpired, OSError):
            proc.kill()


if __name__ == "__main__":
    main()
