# SuiteMail startup diagnostics

The desktop and Android apps send at most one startup result per cold launch after explicit opt-in. The collector validates the request and increments an aggregate by UTC day, result, app version, and operating system. The scheduled cleanup keeps 90 days of aggregates. Cloudflare processes source IPs for short-term rate limiting. The collector does not store IPs or raw events. The endpoint is public and the counts are approximate.

## Dashboard

Open `/dashboard` on the deployed Worker over HTTPS and sign in as `admin`. The page shows reported, ready, and failed launches and the failure rate by version and OS. It defaults to 30 UTC days and offers 7- and 90-day views. The failure rate covers reports received from opt-in launches.

After deploying the Worker, set a strong, randomly generated password at the Wrangler prompt. Use the same command to rotate it.

```sh
wrangler secret put DASHBOARD_PASSWORD --config services/telemetry/wrangler.toml
```

The dashboard is unavailable until the secret is set. Clients can continue to post to the public `/v1/startup` endpoint.

## Query from the command line

Run these commands from the repository root with Wrangler and access to the SuiteMail Cloudflare account.

```sh
wrangler d1 execute DB --remote --config services/telemetry/wrangler.toml \
  --command "SELECT day, version, platform, result, count FROM daily_startups ORDER BY day DESC LIMIT 100"
```

To publish changes, apply migrations before deploying the Worker. Both steps must be complete before Android reports can be accepted.

```sh
wrangler d1 migrations apply DB --remote --config services/telemetry/wrangler.toml
wrangler deploy --config services/telemetry/wrangler.toml
```
