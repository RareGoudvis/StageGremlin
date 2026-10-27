"""A pretend AUDAC MTX88, for trying the AUDAC remote without the real box.

Run:   python scripts/fake-mtx.py
Then in StageGremlin: Settings > AUDAC > IP address 127.0.0.1, port 5001 > Connect.

Like the real MTX it accepts ONE connection at a time (a second one is refused), answers the
commands StageGremlin uses (SV, SVU, SVD, SR, SM, GVALL, GRALL, GMALL, GN1-GN30) and prints what it gets.
"""

import socket

zones = [{"v": 30, "r": 4, "m": 0} for _ in range(8)]
# 1-8 zones, 9-14 inputs 1-6, then two wall-panel input names per zone (inputs 7 and 8).
NAMES = ["Turnzaal", "Lagere school", "Afdak lager", "Speelplaats lager", "Podium", "Kleuters", "Zone 7", "Zone 8",
         "Micro", "Streambox", "CD - USB", "Aux kabel", "Line 5", "Line 6"] + ["WLI", "WMI"] * 8


def handle(line: str) -> list[str]:
    """One command line in, the lines the MTX would send back out."""
    f = [x.strip() for x in line.strip().lstrip("#").strip("|").split("|")]
    if len(f) < 4:
        return []
    cmd, arg = f[2], f[3]
    out = lambda c, a: f"#|SG|X001|{c}|{a}|U|\r\n"
    upd = lambda c, a: f"#|ALL|X001|{c}|{a}|U|\r\n"
    if cmd == "GVALL":
        return [out("VALL", "^".join(str(z["v"]) for z in zones))]
    if cmd == "GRALL":
        return [out("RALL", "^".join(str(z["r"]) for z in zones))]
    if cmd == "GMALL":
        return [out("MALL", "^".join(str(z["m"]) for z in zones))]
    if cmd.startswith("GN") and cmd[2:].isdigit():  # names, like the MTX's own web portal asks them
        n = int(cmd[2:])
        return [out(f"N{n:02}", NAMES[n - 1] if 1 <= n <= len(NAMES) else "")]
    for prefix, key, step in (("SVU0", "v", -3), ("SVD0", "v", 3)):
        if cmd.startswith(prefix):
            n = int(cmd[len(prefix):])
            zones[n - 1]["v"] = max(0, min(70, zones[n - 1]["v"] + step))
            return [out(cmd, "+"), upd(f"V{n:02}", zones[n - 1]["v"])]
    for prefix, key, letter in (("SV", "v", "V"), ("SR", "r", "R"), ("SM0", "m", "M")):
        if cmd.startswith(prefix) and cmd[len(prefix):].isdigit():
            n = int(cmd[len(prefix):])
            zones[n - 1][key] = int(arg)
            return [out(cmd, "+"), upd(f"{letter}{n:02}", arg)]
    return [out(cmd, "+")]


def main():
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", 5001))
    server.listen(0)  # one at a time, like the real box
    print("Fake MTX88 listening on 127.0.0.1:5001 (Ctrl+C to stop)")
    while True:
        conn, addr = server.accept()
        print("client connected:", addr)
        buf = b""
        with conn:
            while True:
                data = conn.recv(1024)
                if not data:
                    print("client left")
                    break
                buf += data
                while b"\n" in buf:
                    raw, buf = buf.split(b"\n", 1)
                    line = raw.decode(errors="replace")
                    print("  <-", line.strip())
                    for reply in handle(line):
                        conn.sendall(reply.encode())


if __name__ == "__main__":
    main()
