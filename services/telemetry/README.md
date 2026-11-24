# SuiteMail startup diagnostics

The desktop app sends at most one startup result per launch after explicit opt-in. The collector validates the request and increments an aggregate by UTC day, result, app version, and operating system. The scheduled cleanup keeps 90 days of aggregates. Cloudflare processes source IPs for short-term rate limiting. The collector does not store IPs or raw events. The endpoint is public and the counts are approximate.

Run these commands from the repository root with Wrangler and access to the SuiteMail Cloudflare account.

```sh
wrangler d1 execute DB --remote --config services/telemetry/wrangler.toml \
  --command "SELECT day, version, platform, result, count FROM daily_startups ORDER BY day DESC LIMIT 100"
```

To publish changes, apply migrations before deploying the Worker.

```sh
wrangler d1 migrations apply DB --remote --config services/telemetry/wrangler.toml
wrangler deploy --config services/telemetry/wrangler.toml
```
