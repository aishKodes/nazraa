# Nazraa Control Platform

A focused, server-backed operations panel for Nazraa Live. It is intentionally one role-aware platform, not separate Master/Admin/Agency applications.

## What is ready

- Role-code login with an HTTP-only signed session cookie
- RBAC plus hierarchy scope (Master → Super Admin → Admin → Agency)
- Global/scoped dashboards, user search, hosts, agencies, and hierarchy
- Atomic admin coin transfers with wallet locks, paired ledger entries, transfer record, and audit event
- Withdrawal review state transitions with status history
- Live room view and a server-computed two-hour moderation restriction
- Transaction explorer and hierarchy-scoped, formula-safe CSV export
- Audit log, risk queue, private-server MySQL access, and first-Master bootstrap

## Configure

For the simplest Hostinger + Vercel setup, follow [HOSTINGER_SETUP.md](HOSTINGER_SETUP.md) and import `hostinger-setup.sql` in phpMyAdmin. No application files belong in Hostinger `public_html`.

For local development, copy `.env.example` to `.env`, run `npm run migrate`, then create a Master with `MASTER_PASSWORD='a-long-unique-password' npm run bootstrap:master`.

The application requires MySQL 8.0+ for recursive hierarchy queries. Use a least-privileged MySQL user and TLS (`DB_SSL=true`) when Hostinger supports it. Do not allow unrestricted remote access in production merely to make Vercel connect.

## Verify

```sh
npm run typecheck
npm run lint
npm run build
```

## Deliberate first-version boundaries

The core operations workflows are implemented. Gift catalogues, banners, seller settlement, notifications, and a mobile support-ticket ingestion endpoint are intentionally not represented as fake editable dashboards yet; they need their corresponding trusted mobile/backend event sources before they can be safely enabled.
