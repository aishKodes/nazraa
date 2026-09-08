# Nazraa Hostinger performance canary

This is an isolated, mutation-free benchmark service. It never handles mobile
traffic and never executes wallet, gift, game, or verification writes.

Required Hostinger environment variables (set in hPanel, never committed):

- `NAZRAA_BENCHMARK_ENABLED=true`
- `NAZRAA_BENCHMARK_KEY` (a high-entropy value)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`
- `DB_CONNECTION_LIMIT=4` initially

Endpoints:

- `GET /healthz`
- `POST /benchmark` with `X-Nazraa-Benchmark-Key` and a valid `operation`

The response contains timing aggregates and no application records or private
user information. The app must remain at zero public/mobile traffic until the
measured canary decision passes.
