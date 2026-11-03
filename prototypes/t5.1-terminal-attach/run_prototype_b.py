"""Verification runner launching CliWrapper and verifying remote observer interactions."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time

from common import (
    MSG_INPUT,
    pack_frame,
    recv_frames_timed,
)

WRAP_SOCKET = "/tmp/shardrail-wrap-prototype-b.sock"


def _verify_remote_observer(sock: socket.socket) -> None:
    """Verify banner reception and remote input injection."""
    initial = recv_frames_timed(sock, 1.0)
    text = "".join(p.decode("utf-8", errors="replace") for t, p in initial if t == 1)
    assert "CLI Wrapper Active" in text, "Initial banner missing!"

    cmd = b"hello from remote observer\n"
    sock.sendall(pack_frame(MSG_INPUT, cmd))

    resp = recv_frames_timed(sock, 1.0)
    resp_text = "".join(p.decode("utf-8", errors="replace") for t, p in resp if t == 1)
    assert "WRAPPER_ECHO:" in resp_text and "hello from remote observer" in resp_text, (
        "Echo response missing!"
    )


def main() -> None:
    """Run CLI wrapper subprocess and execute remote observer test."""
    wrapper_path = os.path.join(os.path.dirname(__file__), "cli_wrapper.py")
    proc = subprocess.Popen(
        [sys.executable, wrapper_path],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    time.sleep(0.5)

    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(WRAP_SOCKET)
        s.setblocking(False)
        try:
            _verify_remote_observer(s)
            print("[RunnerB] TEST PASSED: CLI Wrapper remote observer hook verified.")
        finally:
            s.close()
    finally:
        proc.terminate()
        try:
            proc.communicate(timeout=2.0)
        except (subprocess.TimeoutExpired, OSError):
            proc.kill()


if __name__ == "__main__":
    main()
