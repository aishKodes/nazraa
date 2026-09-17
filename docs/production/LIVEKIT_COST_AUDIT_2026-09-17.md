# LiveKit OCI cost audit — 17 September 2026

This is a point-in-time, console-verified audit for the Nazraa LiveKit deployment in OCI India West (Mumbai, `ap-mumbai-1`). It contains no credentials, tokens, private keys, or customer data.

## Subscription

- Universal Credits infrastructure subscription: active.
- Original credit: SGD 400.00.
- Credit remaining at audit: SGD 391.51 (97%).
- Credit used at audit: SGD 8.49 (3%).
- Trial window remaining at audit: 27 of 30 days.
- OCI reported six billed SKUs in one region. No network-egress SKU had been recorded at this point.

## Resource inventory

| Resource | State | Shape / size | Decision |
| --- | --- | --- | --- |
| `nazraa-livekit-01-replacement` | Running | VM.Standard.E6.Flex, 2 OCPU / 8 GB, 50 GB boot | Production LiveKit VM — retain |
| `nazraa-livekit-01` | Stopped | VM.Standard.E6.Flex, 2 OCPU / 8 GB, 50 GB boot | Retain pending separately approved recovery/deletion decision |
| `nazraa-rescue-access-temp` | Terminated | VM.Standard.E6.Flex, 1 OCPU / 4 GB | Deleted with its boot volume |
| `nazraa-rescue-temp` | Terminated | VM.Standard.E6.Flex, 1 OCPU / 4 GB | Deleted with its boot volume |

There are no standalone block volumes and no boot-volume backups. The only non-terminated boot volumes are the production replacement volume and the stopped original VM volume. The earlier recovery and the two temporary rescue boot volumes are marked `Terminated`.

## Observed rates and operating forecast

OCI's current subscription usage showed these Mumbai rates:

- E6 OCPU: SGD 0.041457 per OCPU-hour.
- E6 memory: SGD 0.002764 per GB-hour.
- Block capacity: SGD 0.035238 per GB-month.
- Block performance: SGD 0.002349 per performance-unit GB-month.

The running 2 OCPU / 8 GB VM is approximately SGD 0.105026 per hour for compute, or about SGD 76.67 over a 730-hour month before storage and outbound data. This is a rate-based forecast, not a promise or a substitute for OCI's invoice.

At audit time, the VM monitoring screen was idle: CPU peaks were about 0.6%, memory was about 9%, and transmit throughput was roughly 1–3 KB/s. No capacity upgrade is justified by this snapshot.

## Media reachability recheck

- `https://rtc.pixtra.site/`: HTTP 200.
- STUN over UDP 3478: binding response passed.
- TURN/TLS with SNI `turn.rtc.pixtra.site` on TCP 443: STUN binding response passed.

## Active spend guardrails

On 17 September 2026, an OCI root-compartment monthly budget named
`nazraa-livekit-monthly-cost` was created with a target of SGD 100.00.

- Actual Spend alert at 50%.
- Actual Spend alert at 75%.
- Actual Spend alert at 90%.
- All three notify the owner-confirmed monitored recipient.

The budget is a notification guardrail; it does not stop or terminate LiveKit
automatically. Review the active resource inventory and current OCI Cost
Analysis before changing or stopping a production resource.

## Required recurring controls

Review weekly:

1. active compute instances and their shapes;
2. non-terminated boot/block volumes and backups;
3. cost-analysis egress and new SKU lines;
4. CPU, memory, and network throughput before any resize;
5. LiveKit HTTPS, STUN/UDP, and TURN/TLS reachability.
