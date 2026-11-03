"""Shared PTY allocation, framing, and socket helpers for terminal attach prototypes."""

from __future__ import annotations

import fcntl
import os
import pty
import select
import signal
import socket
import struct
import termios
import time
from typing import Protocol

MSG_DATA = 1
MSG_INPUT = 2
MSG_RESIZE = 3


def suppress_error(err: BaseException) -> None:
    """Explicitly record a suppressed non-fatal operating system exception."""
    _ = f"suppressed:{err}"


def fork_pty_child(cmd: str, args: list[str]) -> tuple[int, int]:
    """Allocate a PTY pair and fork a child process."""
    master_fd, slave_fd = pty.openpty()
    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.execvp(cmd, [cmd] + args)
        os._exit(1)

    os.close(slave_fd)
    flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
    fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
    return master_fd, pid


def set_pty_size(fd: int, rows: int, cols: int) -> None:
    """Set the window size of a PTY master fd."""
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def pack_frame(msg_type: int, payload: bytes) -> bytes:
    """Pack a message into a typed binary frame."""
    return struct.pack(">BI", msg_type, len(payload)) + payload


def read_available_frames(buf: bytearray) -> list[tuple[int, bytes]]:
    """Parse complete frames from a connection buffer."""
    frames = []
    while len(buf) >= 5:
        msg_type, length = struct.unpack(">BI", buf[:5])
        if len(buf) < 5 + length:
            break
        payload = bytes(buf[5 : 5 + length])
        del buf[: 5 + length]
        frames.append((msg_type, payload))
    return frames


def recv_frames_timed(
    sock: socket.socket, timeout: float = 1.0
) -> list[tuple[int, bytes]]:
    """Receive frames from a socket with a timeout."""
    frames = []
    buf = bytearray()
    deadline = time.time() + timeout
    while time.time() < deadline:
        ready, _, _ = select.select([sock], [], [], 0.05)
        if not ready:
            continue
        try:
            chunk = sock.recv(4096)
        except OSError as err:
            suppress_error(err)
            break
        if not chunk:
            break
        buf.extend(chunk)
        frames.extend(read_available_frames(buf))
    return frames


class PtyStepper(Protocol):
    """Protocol for entities supporting stepping and process monitoring."""

    running: bool
    child_pid: int | None
    master_fd: int | None
    server_sock: socket.socket | None
    socket_path: str

    def step(self) -> None:
        """Process one poll cycle."""
        ...


def run_stepper_loop(target: PtyStepper, timeout: float | None = None) -> None:
    """Run event loop for any PTY stepping server."""
    start = time.time()
    while target.running:
        if timeout and (time.time() - start) > timeout:
            break
        if target.child_pid:
            res = os.waitpid(target.child_pid, os.WNOHANG)
            if res[0] == target.child_pid:
                target.running = False
                break
        target.step()


def teardown_stepper(target: PtyStepper, connections: list[socket.socket]) -> None:
    """Safely terminate child, close descriptors, and clean socket paths."""
    target.running = False
    if target.child_pid:
        try:
            os.kill(target.child_pid, signal.SIGTERM)
        except OSError as err:
            suppress_error(err)
    if target.master_fd is not None:
        try:
            os.close(target.master_fd)
        except OSError as err:
            suppress_error(err)
    for conn in connections:
        conn.close()
    if target.server_sock:
        target.server_sock.close()
    if os.path.exists(target.socket_path):
        os.unlink(target.socket_path)
