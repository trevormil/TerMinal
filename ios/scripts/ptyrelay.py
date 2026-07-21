"""Allocate a real pty and relay it to stdin/stdout.

Used only by e2e-bridge.ts. The bridge's production pty comes from node-pty,
which is compiled against Electron's ABI and cannot load under Bun — and
script(1) refuses to run when its own stdin is a pipe. This gives the harness a
genuine terminal (line discipline, echo, TIOCSWINSZ) over plain pipes.

    python3 ptyrelay.py <cols> <rows> <command> [args...]
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

cols = int(sys.argv[1])
rows = int(sys.argv[2])
command = sys.argv[3:]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(command[0], command)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

try:
    while True:
        readable, _, _ = select.select([fd, 0], [], [], 0.2)
        if fd in readable:
            try:
                data = os.read(fd, 65536)
            except OSError:
                break  # the child closed the pty
            if not data:
                break
            os.write(1, data)
        if 0 in readable:
            data = os.read(0, 65536)
            if not data:
                break
            os.write(fd, data)
except KeyboardInterrupt:
    pass
finally:
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
