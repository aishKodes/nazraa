# Nazraa authenticated mobile API

Base URL: `https://YOUR-VERCEL-DOMAIN/api/v1/mobile`

JSON responses use `Cache-Control: private, no-store` except the public safe config. The Flutter client stores the opaque session in secure storage and sends `Authorization: Bearer <mobile-session>`; it never contains a database or signing secret.

## Session

`POST /session`

```json
{
  "idToken": "google-id-token",
  "deviceLabel": "Nazraa Android",
  "profile": {
    "fullName": "Example User",
    "dateOfBirth": "2000-01-01",
    "gender": "PREFER_NOT_TO_SAY",
    "countryCode": "IN",
    "whatsappE164": "+919999999999",
    "languageCode": "en"
  }
}
```

The server verifies the Google ID token and never trusts a client-provided Google identity. A first request without `profile` can return `requiresProfile: true`; submit the completed profile to create the numeric Nazraa identity, zero-value wallets, host capability, and opaque session. `DELETE /session` revokes the current session.

## Read resources

All except `config` require the Bearer session.

- `GET /config`: mobile-safe gifts, banners, announcements and settings; public 60-second cache.
- `GET /bootstrap`: authoritative profile, access policy, wallet/ledger, rooms, people, catalog, rewards, policy, leaderboards, commerce, payout, levels, and notifications.
- Focused projections additionally include `/daily-rewards`, `/diamond-exchange`, `/host-rewards`, `/policies`, `/leaderboards`, and `/discovery`.

## Authenticated mutations

- `POST /coin-orders` — `{ "packageId": "65000000", "sellerId": "48000000" }`
- `POST /withdrawals` — `{ "amount": 1000, "payoutMethodId": "uuid" }`
- `POST /payout-methods` — `{ "type": "UPI|BANK", "displayName": "Primary", "destination": "private value" }`
- `POST /follows` — `{ "type": "user|agency", "publicId": "numeric", "followed": true }`
- `POST /profile` — editable display name, bio, gender, country, language, WhatsApp, and optional cropped avatar data URL. Numeric IDs, levels, and balances are never accepted.
- `POST /daily-rewards` — no body; one server-day claim, awarded atomically.
- `POST /diamond-exchange` — `{ "diamonds": 100 }`; the active server ratio is applied atomically and written to history.
- `POST /rooms` — `{ "roomCode": "public-room-code", "kind": "live|party|face" }`
- `POST /room-join` — `{ "roomCode": "public-room-code" }`; returns the server-owned room role.
- `POST /room-leave` — `{ "roomCode": "public-room-code" }`; closes active membership and updates the server audience count.
- `POST /room-admins` — `{ "roomCode": "public-room-code", "targetPublicId": "numeric", "makeAdmin": true }`; owner-only and capped at three active admins.
- `POST /live-end` — `{ "roomCode": "public-room-code" }`; finalizes server-measured eligible time and its coin reward exactly once.
- `POST /gifts` — `{ "giftId": "catalog-key", "recipient": "numeric-user-id", "quantity": 1 }`
- `POST /face` — `{ "framesBase64": ["base64-jpeg", "..."], "consentVersion": "nazraa-biometric-1.0" }`; two to four fresh guided frames, no government ID or ordinary manual review.
- `POST /zego-token` — `{ "roomId": "public-room-code", "publish": false }`; room-scoped Token04 signed only on the server.

The server rechecks the centralized access policy and authoritative room role for every protected mutation. Unverified users can browse, join, use the wallet, follow, buy, claim rewards, and use agency features, but cannot own Party/video/chat rooms. Face Live additionally requires verified identity plus agency and Super Admin authorization. Buyer devices cannot complete an order, credit a wallet, approve a payout, change a role/level, or review verification.

## Legacy trusted-backend routes

The older `/api/v1/users/sync`, `/api/v1/host-applications` and `/api/v1/support/tickets` routes continue to use `MOBILE_API_KEY` for a trusted server integration. That key must never be embedded in Flutter. The production Flutter application uses only `/api/v1/mobile/*`.
