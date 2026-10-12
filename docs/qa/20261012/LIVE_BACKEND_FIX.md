# Independent Live backend reliability correction

Production logs repeatedly showed MariaDB `ER_CHECKREAD` (1020) on a room member
snapshot/cleanup race. Presence reconciliation could fail even while RTC stayed
connected. This does not prove that all client reconnects have the same cause.

The presence transaction now uses the existing bounded idempotent transaction
wrapper. A confirmed concurrent-read conflict rolls back the entire attempt
before retry. Durable reward uniqueness and monotonic session checkpoints are
unchanged. Unkeyed operations and ambiguous connection/commit failures are never
automatically replayed.

`verify-transaction-conflict-retry.ts` verifies rollback, exactly one durable
write, no unkeyed replay and no ambiguous-connection replay using an isolated
local database.

A second confirmed mismatch was an owner/test bootstrap saying Face access was
active for a rejected verification, while canonical room creation denied it.
Bootstrap now matches the existing creation requirement. Party remains
independent from Face verification. `verify-live-access-bootstrap.ts` covers
normal/owner pending, rejected, verified and restricted accounts. No production
verification is approved or bypassed, and no reward/economy/age rule changes.

Neither correction changes LiveKit routing, publication settings, Redis/WS,
MySQL schema or the mobile release. Real media soak/reconnect/PK checks remain
separate release gates; local transaction tests alone are not media QA.
