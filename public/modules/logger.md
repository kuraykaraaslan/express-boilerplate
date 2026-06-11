# logger

- **id:** `logger`
- **tier:** infrastructure
- **dir:** `modules/logger/`
- **hasExpressLayer:** true

Winston tabanlı framework-agnostic logger servisi.

## Services

- `logger.service.ts`

## Express layer (modules_express/) surface

- `logger/logger.service.express` _(service.express)_

## README

# logger

Winston tabanlı framework-agnostic logger servisi.

## Exports

- `Logger` (default) — `info`, `error`, `warn`, `debug` static metodları

## Kullanım

```ts
import Logger from '@/modules/logger';

Logger.info('User created', { userId });
Logger.error('DB failure', error);
```

`libs/logger` backward compat için bu modülü re-export eder.
