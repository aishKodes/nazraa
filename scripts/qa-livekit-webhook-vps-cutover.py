"""Execute on the existing LiveKit VM after the signed connectivity probe.

Changes only the obsolete webhook URL, keeps a root-only rollback copy, and
restarts only LiveKit, only when a fresh participant inventory is empty.
Run together with qa-livekit-webhook-connectivity.py in the same Python process.
"""
import copy
import os
from pathlib import Path
import shutil
import subprocess
import sys


OLD = "https://nazraa.vercel.app/api/internal/livekit/webhook"
path = Path(CONFIG)
before = path.read_text(encoding="utf-8")
before_config = yaml.safe_load(before)
urls = before_config["webhook"]["urls"]
if urls == [OLD]:
    if before.count(OLD) != 1:
        raise SystemExit("UNEXPECTED_WEBHOOK_CONFIG")
    after = before.replace(OLD, TARGET)
    expected = copy.deepcopy(before_config)
    expected["webhook"]["urls"] = [TARGET]
    if yaml.safe_load(after) != expected:
        raise SystemExit("CONFIG_PARITY_FAILED")
    os.umask(0o077)
    backup_dir = Path("/root/livekit-backups/webhook-vps-20261013")
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = backup_dir / ("livekit.yaml." + str(time.time_ns()))
    shutil.copy2(path, backup)
    backup.chmod(0o600)
    # Mechanical exact-string replacement; leave all keys/media settings intact.
    subprocess.run(["sed", "-i", "s|" + OLD + "|" + TARGET + "|", str(path)], check=True)
    if yaml.safe_load(path.read_text(encoding="utf-8")) != expected:
        shutil.copy2(backup, path)
        raise SystemExit("CONFIG_VALIDATION_FAILED_ROLLED_BACK")
    print("WEBHOOK_VPS_URL_STAGED; root-only backup=" + str(backup))
elif urls == [TARGET]:
    print("WEBHOOK_VPS_URL_ALREADY_STAGED")
else:
    raise SystemExit("UNEXPECTED_WEBHOOK_DESTINATIONS")

# Do not restart based on cached room metadata (protobuf snake/camel naming can
# conceal counts). Query actual participants immediately before any restart.
def active_participants():
    status, data = request(
        "http://127.0.0.1:7880/twirp/livekit.RoomService/ListRooms", b"{}",
        "Bearer " + token({"video": {"roomList": True}}),
    )
    if status != 200:
        raise SystemExit("FRESH_ROOM_INVENTORY_FAILED_NO_RESTART")
    active = 0
    for room in json.loads(data).get("rooms", []):
        status, data = request(
            "http://127.0.0.1:7880/twirp/livekit.RoomService/ListParticipants",
            json.dumps({"room": room["name"]}).encode(),
            "Bearer " + token({"video": {"roomAdmin": True, "room": room["name"]}}),
        )
        if status != 200:
            raise SystemExit("FRESH_PARTICIPANT_INVENTORY_FAILED_NO_RESTART")
        active += len(json.loads(data).get("participants", []))
    return active


# Optional bounded deployment wait, not a permanent daemon/cron. There is no
# SQL polling, no financial command, and no forced restart of active sessions.
wait_seconds = 0
if len(sys.argv) == 2 and sys.argv[1].startswith("--wait-idle-seconds="):
    wait_seconds = int(sys.argv[1].split("=", 1)[1])
if not 0 <= wait_seconds <= 1800:
    raise SystemExit("INVALID_IDLE_WAIT_LIMIT")
deadline = time.monotonic() + wait_seconds
while True:
    active = active_participants()
    if not active:
        subprocess.run(["docker", "restart", "--time", "30", "rtcpixtrasite-livekit-1"], check=True)
        print("LIVEKIT_RESTARTED_AT_ZERO_PARTICIPANTS; Caddy/Redis unchanged", flush=True)
        break
    if time.monotonic() >= deadline:
        print("LIVEKIT_RESTART_DEFERRED; active participants=" + str(active), flush=True)
        break
    print("WAITING_FOR_IDLE; active participants=" + str(active), flush=True)
    time.sleep(min(30, max(0, deadline - time.monotonic())))
