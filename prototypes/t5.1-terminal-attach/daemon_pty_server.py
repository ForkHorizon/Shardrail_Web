"""Daemon-managed PTY server prototype multiplexing I/O and handling reconnection."""

from __future__ import annotations

import os
import select
import socket
import struct

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

SOCKET_PATH = "/tmp/shardrail-pty-prototype-a.sock"
SCROLLBACK_MAX = 65536


class DaemonPtyServer:
    """Manages an agent subprocess inside a PTY and streams I/O to client sockets."""

    def __init__(self, cmd: str, args: list[str], socket_path: str = SOCKET_PATH):
        self.cmd = cmd
        self.args = args
        self.socket_path = socket_path
        self.master_fd: int | None = None
        self.child_pid: int | None = None
        self.server_sock: socket.socket | None = None
        self.clients: list[socket.socket] = []
        self.scrollback = bytearray()
        self.running = False

    def start(self) -> None:
        """Start child process in PTY and bind listening socket."""
        if os.path.exists(self.socket_path):
            os.unlink(self.socket_path)
        self.master_fd, self.child_pid = fork_pty_child(self.cmd, self.args)
        self.server_sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server_sock.bind(self.socket_path)
        self.server_sock.listen(5)
        self.server_sock.setblocking(False)
        self.running = True

    def _accept_client(self) -> None:
        """Accept a new client connection and send scrollback replay."""
        if not self.server_sock:
            return
        conn, _ = self.server_sock.accept()
        conn.setblocking(False)
        self.clients.append(conn)
        if self.scrollback:
            frame = pack_frame(MSG_DATA, bytes(self.scrollback))
            try:
                conn.sendall(frame)
            except OSError as err:
                suppress_error(err)

    def _broadcast_data(self, data: bytes) -> None:
        """Append data to scrollback and broadcast to connected clients."""
        self.scrollback.extend(data)
        if len(self.scrollback) > SCROLLBACK_MAX:
            self.scrollback = self.scrollback[-SCROLLBACK_MAX:]
        frame = pack_frame(MSG_DATA, data)
        dead = []
        for client in self.clients:
            try:
                client.sendall(frame)
            except OSError:
                dead.append(client)
        for client in dead:
            self.clients.remove(client)
            client.close()

    def _handle_client_input(self, client: socket.socket) -> None:
        """Read and dispatch input or resize commands from a client."""
        try:
            hdr = client.recv(5)
            if not hdr:
                self.clients.remove(client)
                client.close()
                return
            msg_type, length = struct.unpack(">BI", hdr)
            payload = client.recv(length)
            if msg_type == MSG_INPUT and self.master_fd is not None:
                os.write(self.master_fd, payload)
            elif msg_type == MSG_RESIZE and self.master_fd is not None:
                rows, cols = struct.unpack(">HH", payload)
                set_pty_size(self.master_fd, rows, cols)
        except OSError:
            if client in self.clients:
                self.clients.remove(client)
            client.close()

    def step(self) -> None:
        """Execute one iteration of the server event loop."""
        if self.server_sock is None or self.master_fd is None:
            return
        rlist = [self.server_sock, self.master_fd] + self.clients
        try:
            readable, _, _ = select.select(rlist, [], [], 0.05)
        except (OSError, InterruptedError):
            return

        for s in readable:
            if s is self.server_sock:
                self._accept_client()
            elif s is self.master_fd:
                try:
                    data = os.read(self.master_fd, 4096)
                except OSError:
                    data = b""
                if data:
                    self._broadcast_data(data)
            elif isinstance(s, socket.socket):
                self._handle_client_input(s)

    def run_loop(self, timeout: float | None = None) -> None:
        """Run the server event loop until exit or timeout."""
        run_stepper_loop(self, timeout)

    def stop(self) -> None:
        """Tear down server, disconnect clients, and terminate child process."""
        teardown_stepper(self, self.clients)


if __name__ == "__main__":
    srv = DaemonPtyServer(
        "/bin/sh",
        [
            "-c",
            "echo 'Welcome to Shardrail Managed PTY'; while read line; do echo 'ECHO: ' $line; done",
        ],
    )
    srv.start()
    try:
        srv.run_loop(timeout=15)
    finally:
        srv.stop()
