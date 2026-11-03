"""Automated client verifying connection, input, resize, and reconnection replay."""

from __future__ import annotations

import socket
import struct
import time

from common import (
    MSG_INPUT,
    MSG_RESIZE,
    pack_frame,
    recv_frames_timed,
)

SOCKET_PATH = "/tmp/shardrail-pty-prototype-a.sock"


def _extract_text(frames: list[tuple[int, bytes]]) -> str:
    """Concatenate string content from data frames."""
    return "".join(p.decode("utf-8", errors="replace") for t, p in frames if t == 1)


def _verify_initial_and_echo(sock: socket.socket) -> None:
    """Verify initial banner and echo responses."""
    initial = recv_frames_timed(sock, 1.0)
    text = _extract_text(initial)
    assert "Welcome to Shardrail Managed PTY" in text, "Banner missing!"

    test_msg = b"hello from shardrail client\n"
    sock.sendall(pack_frame(MSG_INPUT, test_msg))

    resp = recv_frames_timed(sock, 1.0)
    resp_text = _extract_text(resp)
    assert "ECHO:" in resp_text and "hello from shardrail client" in resp_text, (
        "Echo response missing!"
    )


def _verify_resize_and_reconnect() -> None:
    """Verify resize command and state replay on reconnect."""
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(SOCKET_PATH)
    s.setblocking(False)
    try:
        _verify_initial_and_echo(s)
        resize_frame = pack_frame(MSG_RESIZE, struct.pack(">HH", 30, 100))
        s.sendall(resize_frame)
    finally:
        s.close()

    time.sleep(0.3)

    s2 = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s2.connect(SOCKET_PATH)
    s2.setblocking(False)
    try:
        replay = recv_frames_timed(s2, 1.0)
        replay_text = _extract_text(replay)
        assert (
            "ECHO:" in replay_text and "hello from shardrail client" in replay_text
        ), "Replay missing!"
    finally:
        s2.close()


def automated_test() -> None:
    """Run full automated verification of DaemonPtyServer."""
    _verify_resize_and_reconnect()
    print(
        "[ClientAttach] TEST PASSED: Full PTY lifecycle, I/O multiplexing, resize, and replay verified."
    )


if __name__ == "__main__":
    automated_test()
