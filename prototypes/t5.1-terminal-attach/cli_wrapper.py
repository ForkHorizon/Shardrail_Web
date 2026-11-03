"""CLI wrapper prototype proxying local terminal and providing remote attach hook."""

from __future__ import annotations

import os
import select
import socket
import struct
import sys

from common import (
    MSG_DATA,
    MSG_INPUT,
    MSG_RESIZE,
    fork_pty_child,
    pack_frame,
    run_stepper_loop,
    set_pty_size,
    suppress_error,
    teardown_stepper,
)

WRAP_SOCKET = "/tmp/shardrail-wrap-prototype-b.sock"
SCROLLBACK_MAX = 65536


class CliWrapper:
    """Wraps command in a local PTY while exposing a remote attach socket."""

    def __init__(
        self,
        cmd: str,
        args: list[str],
        socket_path: str = WRAP_SOCKET,
        headless: bool = False,
    ):
        self.cmd = cmd
        self.args = args
        self.socket_path = socket_path
        self.headless = headless
        self.master_fd: int | None = None
        self.child_pid: int | None = None
        self.server_sock: socket.socket | None = None
        self.remote_clients: list[socket.socket] = []
        self.scrollback = bytearray()
        self.running = False

    def start(self) -> None:
        """Start wrapped child in PTY and bind attach listener."""
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
        self.master_fd, self.child_pid = fork_pty_child(self.cmd, self.args)
        self.server_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server_sock.bind(self.socket_path)
        self.server_sock.listen(5)
        self.server_sock.setblocking(False)
        self.running = True

    def _accept_remote(self) -> None:
        """Accept a remote observer connection and replay buffered history."""
        if not self.server_sock:
            return
        conn, _ = self.server_sock.accept()
        conn.setblocking(False)
        self.remote_clients.append(conn)
        if self.scrollback:
            frame = pack_frame(MSG_DATA, bytes(self.scrollback))
            try:
                conn.sendall(frame)
            except OSError as err:
                suppress_error(err)

    def _handle_pty_output(self) -> None:
        """Read PTY master data, mirror to local terminal and send to remote observers."""
        if self.master_fd is None:
            return
        try:
            data = os.read(self.master_fd, 4096)
        except OSError:
            data = b""
        if not data:
            return
        self.scrollback.extend(data)
        if len(self.scrollback) > SCROLLBACK_MAX:
            self.scrollback = self.scrollback[-SCROLLBACK_MAX:]
        if not self.headless:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()

        frame = pack_frame(MSG_DATA, data)
        dead = []
        for rc in self.remote_clients:
            try:
                rc.sendall(frame)
            except OSError:
                dead.append(rc)
        for d in dead:
            self.remote_clients.remove(d)
            d.close()

    def _handle_remote_input(self, s: socket.socket) -> None:
        """Receive remote input or resize command."""
        try:
            hdr = s.recv(5)
            if not hdr:
                self.remote_clients.remove(s)
                s.close()
                return
            msg_type, length = struct.unpack(">BI", hdr)
            payload = s.recv(length)
            if msg_type == MSG_INPUT and self.master_fd is not None:
                os.write(self.master_fd, payload)
            elif msg_type == MSG_RESIZE and self.master_fd is not None:
                rows, cols = struct.unpack(">HH", payload)
                set_pty_size(self.master_fd, rows, cols)
        except OSError:
            if s in self.remote_clients:
                self.remote_clients.remove(s)
            s.close()

    def step(self) -> None:
        """Process one poll step."""
        if self.server_sock is None or self.master_fd is None:
            return
        rlist = [self.server_sock, self.master_fd] + self.remote_clients
        try:
            readable, _, _ = select.select(rlist, [], [], 0.05)
        except (OSError, InterruptedError):
            return

        for s in readable:
            if s is self.server_sock:
                self._accept_remote()
            elif s is self.master_fd:
                self._handle_pty_output()
            elif isinstance(s, socket.socket):
                self._handle_remote_input(s)

    def run_loop(self, timeout: float | None = None) -> None:
        """Run wrapper loop until child exit or timeout."""
        run_stepper_loop(self, timeout)

    def stop(self) -> None:
        """Cleanly terminate child and release sockets."""
        teardown_stepper(self, self.remote_clients)


if __name__ == "__main__":
    wrap = CliWrapper(
        "/bin/sh",
        [
            "-c",
            "echo 'CLI Wrapper Active'; while read line; do echo 'WRAPPER_ECHO: ' $line; done",
        ],
        headless=True,
    )
    wrap.start()
    try:
        wrap.run_loop(timeout=15)
    finally:
        wrap.stop()
