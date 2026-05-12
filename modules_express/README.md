# modules_express

Express'e özgü katman. `modules/` içindeki framework-agnostic iş mantığının Express bağımlılıklarını barındıran uzantısı.

## Kural

`modules/` altında hiçbir dosya `express` paketi veya `Request` / `Response` / `NextFunction` tiplerine import içermez. Bu tür bağımlılıklar buraya taşınır.

## Klasör Yapısı

```
modules_express/
├── auth/
│   ├── middleware/
│   │   └── index.ts                        # AuthMiddleware factory (role tabanlı)
│   └── utils/
│       └── user-agent.util.express.ts      # parseRequest(req) — Request'ten UserAgentData çıkarır
│
├── tenant_member/
│   └── middleware/
│       └── index.ts                        # TenantMemberMiddleware factory (rol tabanlı)
│
├── tenant_session/
│   └── tenant_session.service.express.ts  # TenantSessionExpressService — Request'ten tenant doğrulama
│
└── user_session/
    └── user_session.service.express.ts    # extractRequestContext, authenticateUserByRequest
```

## İçerik Türleri

| Tür | Nereye | Örnek |
|---|---|---|
| Express middleware | `modules_express/<module>/middleware/index.ts` | `AuthMiddleware`, `TenantMemberMiddleware` |
| Express servis uzantısı | `modules_express/<module>/<module>.service.express.ts` | `TenantSessionExpressService` |
| Express util uzantısı | `modules_express/<module>/utils/<util>.express.ts` | `parseRequest` |

## Bağımlılık Yönü

```
router/  →  modules_express/  →  modules/
```

- `modules_express` her zaman `modules/`'den import edebilir
- `modules/` asla `modules_express/`'ten import edemez
- `router/` her iki katmandan da import edebilir
