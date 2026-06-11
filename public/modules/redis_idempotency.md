# idempotency

- **id:** `redis_idempotency`
- **tier:** infrastructure
- **dir:** `modules/redis_idempotency/`
- **hasExpressLayer:** false

Redis tabanlı idempotency key yönetimi.

## Services

- `redis_idempotency.service.ts`

## README

# idempotency

Redis tabanlı idempotency key yönetimi.

## Exports

- `IdempotencyKey` — `get`, `setPending`, `setCompleted` static metodları
- `IdempotencyRecord` — `{ status, response? }` tipi
- `IdempotencyStatus` — `'pending' | 'completed'`

TTL: 24 saat.

Next.js `withIdempotency` middleware HOC → `modules_next/idempotency`.
