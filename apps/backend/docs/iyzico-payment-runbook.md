# iyzico Payment Provider Skeleton

Current status:

- Provider skeleton only.
- Network transport is disabled by default.
- No real iyzico API request is made.
- No region is linked to `pp_iyzico_iyzico` in this phase.
- Webhook boundary validates and normalizes only; it performs no DB mutation.

Provider ID:

- Medusa identifier: `iyzico`
- Config id: `iyzico`
- Runtime provider id: `pp_iyzico_iyzico`

Environment names:

- `IYZICO_PROVIDER_ENABLED`
- `IYZICO_MODE`
- `IYZICO_API_KEY`
- `IYZICO_SECRET_KEY`
- `IYZICO_BASE_URL`
- `IYZICO_CALLBACK_URL`
- `IYZICO_RETURN_URL`
- `IYZICO_WEBHOOK_SECRET`
- `IYZICO_NETWORK_ENABLED`

Safety:

- `IYZICO_PROVIDER_ENABLED` defaults to off.
- `IYZICO_NETWORK_ENABLED` defaults to false.
- Local production mode is blocked.
- Sandbox mode rejects production-looking base URLs.
- Production mode rejects sandbox base URLs and localhost callback URLs.
- Secrets must not be logged or committed.

Next phase:

1. Add real sandbox credentials outside Git.
2. Keep network disabled and verify config boot.
3. Implement checkout form initialize transport behind `IYZICO_NETWORK_ENABLED=true`.
4. Add signed webhook route in disabled/no-mutation mode.
5. Only then link the provider to the Türkiye region in a guarded operation.
