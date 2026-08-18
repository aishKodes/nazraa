# Nazraa authenticated mobile API

Base URL: `https://YOUR-VERCEL-DOMAIN/api/v1/mobile`

JSON responses use `Cache-Control: private, no-store` except the public safe config. The Flutter client stores the opaque session in secure storage and sends `Authorization: Bearer <mobile-session>`; it never contains a database or signing secret.

## Session

`POST /session`

```json
{
  "fullName": "Example User",
  "countryCode": "IN",
  "deviceLabel": "Nazraa Android"
}
```

Creates a numeric user with zero-value wallets and returns the opaque session once. `DELETE /session` revokes the current session.

## Read resources

All except `config` require the Bearer session.

- `GET /config`: mobile-safe gifts, banners, announcements and settings; public 60-second cache.
- `GET /bootstrap`: authoritative profile, role grants, wallet/ledger, rooms, people, catalog, commerce, payout, levels and notifications.
- Focused projections: `/auth`, `/profile`, `/wallet`, `/rooms`, `/live`, `/party`, `/face`, `/agency`, `/host`, `/banners`, `/withdrawals`, `/notifications`, `/levels`, `/gifts`, `/coin-packages`, `/coin-sellers`, `/coin-orders`.

## Authenticated mutations

- `POST /coin-orders` — `{ "packageId": "65000000", "sellerId": "48000000" }`
- `POST /withdrawals` — `{ "amount": 1000, "payoutMethodId": "uuid" }`
- `POST /payout-methods` — `{ "type": "UPI|BANK", "displayName": "Primary", "destination": "private value" }`
- `POST /follows` — `{ "type": "user|agency", "publicId": "numeric", "followed": true }`
- `POST /rooms` — `{ "roomCode": "public-room-code", "kind": "live|party|face" }`
- `POST /gifts` — `{ "giftId": "catalog-key", "recipient": "numeric-user-id", "quantity": 1 }`
- `POST /face` — `{ "selfieBase64": "base64-jpeg" }`; fresh selfie only, no government ID.
- `POST /zego-token` — `{ "roomId": "public-room-code", "publish": false }`; room-scoped Token04 signed only on the server.

The server rechecks the authenticated role for every protected mutation. Buyer devices cannot complete an order, credit a wallet, approve a payout, change a role/level, or review Face verification.

## Legacy trusted-backend routes

The older `/api/v1/users/sync`, `/api/v1/host-applications` and `/api/v1/support/tickets` routes continue to use `MOBILE_API_KEY` for a trusted server integration. That key must never be embedded in Flutter. The production Flutter application uses only `/api/v1/mobile/*`.
