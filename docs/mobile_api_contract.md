# Nazraa mobile integration

Base URL: `https://YOUR-VERCEL-DOMAIN/api/v1`

The mutation routes below are server-to-server routes. Send `Authorization: Bearer <MOBILE_API_KEY>` from the trusted Nazraa mobile backend. Do not put this key inside the Flutter application.

## Sync a mobile user

`POST /users/sync` with JSON:

```json
{
  "externalUserId": "NZ10001",
  "fullName": "Example User",
  "countryCode": "IN",
  "avatarUrl": "https://optional.example/avatar.jpg",
  "agencyCode": "AG-OPTIONAL"
}
```

Call this after registration/profile changes and before a host application or support ticket.

## Submit a host application

`POST /host-applications` as `multipart/form-data`:

- `externalUserId`, `legalName`, `countryCode`
- `governmentIdType`, `governmentIdLast4`
- optional `agencyCode`
- required `idFront`; optional `idBack`, `profilePhoto`

Files may be JPG, PNG, or PDF and must be no larger than 2 MB each. The control platform encrypts them before MySQL storage. The response status is `PENDING`; reviewers approve or reject it in **Hosts**.

## Create a support ticket

`POST /support/tickets` with JSON:

```json
{
  "externalUserId": "NZ10001",
  "subject": "Withdrawal question",
  "category": "WITHDRAWAL",
  "priority": "NORMAL",
  "message": "Please check my request."
}
```

## Fetch app configuration

`GET /config` is public and returns active gifts, currently scheduled banners, published notifications, and mobile-safe settings. It is cached for 60 seconds.
