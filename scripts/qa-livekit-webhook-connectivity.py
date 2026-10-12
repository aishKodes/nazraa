"""Run on the existing LiveKit VM; secrets stay in memory and are never printed.

Read-only room inventory plus a signed, unsupported webhook event. The probe
cannot create publishing evidence, a reward, or a financial transaction.
"""
import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
import uuid

import yaml


CONFIG = "/root/livekit-generate/rtc.pixtra.site/livekit.yaml"
TARGET = "https://api.nazraa.pixtra.site/api/internal/livekit/webhook"


def encoded(value):
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=")


with open(CONFIG, encoding="utf-8") as source:
    config = yaml.safe_load(source)
key = config["webhook"]["api_key"]
secret = config["keys"][key].encode()


def token(claims):
    now = int(time.time())
    payload = {"iss": key, "iat": now, "nbf": now - 1, "exp": now + 60, **claims}
    signing_input = encoded({"alg": "HS256", "typ": "JWT"}) + b"." + encoded(payload)
    signature = hmac.new(secret, signing_input, hashlib.sha256).digest()
    return (signing_input + b"." + base64.urlsafe_b64encode(signature).rstrip(b"=")).decode()


def request(url, body, authorization):
    headers = {"Content-Type": "application/json", "Authorization": authorization}
    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, b""
    except (urllib.error.URLError, TimeoutError):
        return 0, b""


status, data = request(
    "http://127.0.0.1:7880/twirp/livekit.RoomService/ListRooms",
    b"{}",
    "Bearer " + token({"video": {"roomList": True}}),
)
if status != 200:
    raise SystemExit("ROOM_INVENTORY_FAILED")
rooms = json.loads(data).get("rooms", [])
participants = 0
publishers = 0
for room in rooms:
    room_name = room["name"]
    status, data = request(
        "http://127.0.0.1:7880/twirp/livekit.RoomService/ListParticipants",
        json.dumps({"room": room_name}).encode(),
        "Bearer " + token({"video": {"roomAdmin": True, "room": room_name}}),
    )
    if status != 200:
        raise SystemExit("PARTICIPANT_INVENTORY_FAILED")
    current = json.loads(data).get("participants", [])
    participants += len(current)
    publishers += sum(bool(participant.get("tracks", [])) for participant in current)

body = json.dumps({"event": "", "id": "qa-connectivity-" + str(uuid.uuid4())}).encode()
digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
valid_token = token({"sha256": digest})
valid, _ = request(TARGET, body, valid_token)
head, payload, signature = valid_token.split(".")
invalid_token = ".".join((head, payload, ("A" if signature[0] != "A" else "B") + signature[1:]))
invalid, _ = request(TARGET, body, invalid_token)
tampered, _ = request(TARGET, body, token({"sha256": "invalid-body-checksum"}))
expired, _ = request(TARGET, body, token({"sha256": digest, "iat": 1, "nbf": 1, "exp": 2}))
print(json.dumps({
    "livekitVersion": "running image recorded separately",
    "roomCount": len(rooms),
    "participantCount": participants,
    "publisherCount": publishers,
    "signedVpsProbeStatus": valid,
    "invalidSignatureProbeStatus": invalid,
    "tamperedBodyProbeStatus": tampered,
    "expiredProbeStatus": expired,
    "probeCreatesMediaEvidence": False,
}))
if valid != 202 or invalid != 404 or tampered != 404 or expired != 404:
    raise SystemExit("WEBHOOK_CONNECTIVITY_FAILED")
