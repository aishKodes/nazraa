# Nazraa production LiveKit runbook

Last verified: 2026-09-26

## Service ownership

- Media provider: `MEDIA_PROVIDER=LIVEKIT` in Vercel Production.
- Public signalling endpoint: `wss://rtc.pixtra.site`.
- Public TURN endpoint: `turn.rtc.pixtra.site`.
- LiveKit is self-hosted in OCI Mumbai on `nazraa-livekit-01-replacement`.
- The mobile app never contains a LiveKit API secret. Vercel issues short-lived,
  role-scoped participant tokens with `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
  `LIVEKIT_API_SECRET` held only as Production secrets.

## Maintenance access

The authorized development Mac has a `nazraa-livekit` alias in its private
`~/.ssh/config`. It connects as `ubuntu` to `rtc.pixtra.site` with the existing
OCI identity file and strict host-key checking. On 2026-09-26, a noninteractive
SSH command through that alias succeeded, and Caddy, LiveKit, and Redis were
healthy. The SSH private key and the pinned host key are not stored in this
repository.

This alias makes routine access simple, but it does not guarantee access if the
Mac's public IP changes: OCI ingress rules still determine reachability. Before
an incident, verify `ssh -o BatchMode=yes nazraa-livekit 'hostname'` from the
authorized Mac. Never broaden SSH ingress to the public Internet just to make
the alias work; use an approved narrow source rule or private maintenance path.

## Network contract

Keep only these public media/maintenance ports open at OCI and UFW:

| Protocol | Port(s) | Purpose |
| --- | --- | --- |
| TCP | 22 | Administrators' SSH access |
| TCP | 80 | ACME HTTP validation only |
| TCP | 443 | HTTPS/WSS signalling and TURN/TLS SNI ingress |
| TCP | 7881 | LiveKit ICE/TCP fallback |
| TCP/UDP | 3478 | TURN/STUN |
| TCP | 5349 | Existing TURN/TLS fallback listener |
| UDP | 50000-60000 | WebRTC media |

`turn.rtc.pixtra.site:443` is the public TURN/TLS endpoint. Caddy terminates
the external TLS/SNI route and proxies it to LiveKit's private listener. Do
not expose Redis. The 5349 listener is retained as a configured TURN fallback;
do not remove it until a real mobile ICE candidate inspection confirms that no
client receives or needs it.

## Runtime and restart safety

- Compose directory: `/root/livekit-generate/rtc.pixtra.site` on the LiveKit VM.
- Runtime containers: Caddy, LiveKit, and private Redis.
- System service: `nazraa-livekit.service`.
- Verify after a host reboot:

```sh
sudo systemctl is-active nazraa-livekit.service
sudo docker compose -f /root/livekit-generate/rtc.pixtra.site/docker-compose.yaml ps
```

Never print `livekit.yaml`, `.env`, Docker inspect output, or Vercel secret
values in logs, tickets, terminals shared with others, or source control.

## Authoritative application integration

1. Flutter receives only the backend's `livekit-token` response.
2. Passive viewers receive a subscribe-only grant.
3. Face Hosts receive camera + microphone grants.
4. Accepted Face guests and Party speakers receive microphone-only grants.
5. Room role changes require a newly authorized token; clients cannot elevate
   themselves by requesting a camera track.
6. The LiveKit webhook posts signed events to
   `/api/internal/livekit/webhook`. The backend deduplicates provider event
   IDs and applies them as media evidence to the existing live-session ledger.
7. Rewards remain claimable and continue to use the existing server-time
   accounting model; provider events are evidence, never a client-side payout.

## Minimum release checks

Run these checks after a deployment or media configuration change:

1. `https://rtc.pixtra.site` returns HTTPS successfully.
2. A STUN binding succeeds over UDP 3478.
3. A STUN binding succeeds over TLS with SNI `turn.rtc.pixtra.site` on port
   443.
4. The backend's LiveKit staging test passes:

```sh
npm run test:livekit-staging
```

5. Start a normal Face room with two ordinary accounts: Host camera/mic,
   viewer subscribe-only, then promoted audio guest microphone-only.
6. Start a Party room: owner audio, passive subscribe-only, promoted speaker
   microphone-only, and demotion/rejoin.
7. Check the signed webhook is being accepted before treating a new provider
   as valid reward evidence.

## Incident rules

- Do not re-enable ZEGO or an unlimited passive RTC fallback to mask a
  LiveKit outage.
- Do not rotate LiveKit credentials as a first response. First establish
  whether the fault is DNS/TLS, ICE/TURN, token issuance, room authorization,
  or a media-publisher issue.
- If maintenance access is at risk, retain the established private rescue
  route until an independent SSH or serial-console path is verified. Deleting
  a rescue VM before that verification is not an acceptable cost optimization.
