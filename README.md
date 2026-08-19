# Nazraa Control Platform

A focused, server-backed operations panel for Nazraa Live. It is intentionally one role-aware platform, not separate Master/Admin/Agency applications.

## What is ready

- Role-code login with an HTTP-only signed session cookie
- RBAC plus hierarchy scope (Master → Super Admin → Admin → Agency)
- Mobile-friendly navigation plus real global user search
- Master-created panel accounts, subordinate account management, password reset, and encrypted ID document review
- Google-authenticated mobile onboarding with editable profiles and automatic host enablement
- Automatic face liveness/duplicate verification with separate Agency and Super Admin Face Live authorization
- Global/scoped dashboards, users, hosts, agencies, and hierarchy
- Idempotent atomic coin transfers with wallet locks, paired ledger entries, transfer record, and audit event
- Withdrawal review state transitions with status history
- Live/party room lock/end controls and a server-computed two-hour moderation restriction
- Transaction explorer and hierarchy-scoped, formula-safe CSV export
- Gift catalogue, banner scheduling, daily rewards, host reward rates, atomic diamond conversion, notification publishing, support, and risk controls
- Versioned authenticated mobile endpoints with centralized access policy, authoritative room roles, real leaderboards, and public configuration
- Audit log, private-server MySQL access, and first-Master bootstrap

## Configure

For the simplest Hostinger + Vercel setup, follow [HOSTINGER_SETUP.md](HOSTINGER_SETUP.md). Existing installations import `hostinger-update.sql` once; new installations import `hostinger-setup.sql` followed by `hostinger-update.sql`. No application files belong in Hostinger `public_html`.

For local development, copy `.env.example` to `.env`, run `npm run migrate`, then create a Master with `MASTER_PASSWORD='a-long-unique-password' npm run bootstrap:master`.

The application requires MySQL 8.0+ for recursive hierarchy queries. Use a least-privileged MySQL user and TLS (`DB_SSL=true`) when Hostinger supports it. Do not allow unrestricted remote access in production merely to make Vercel connect.

## Verify

```sh
npm run typecheck
npm run lint
npm run build
```

## Mobile integration boundary

The production Flutter client uses the authenticated contract in [docs/mobile_api_contract.md](docs/mobile_api_contract.md). Google and biometric setup requirements are in [docs/production_identity_setup.md](docs/production_identity_setup.md). Never embed `MOBILE_API_KEY`, a biometric provider secret, or `ZEGO_SERVER_SECRET` in a distributable mobile binary.
