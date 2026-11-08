export const FEATURE_KEYS = {
  // LIMIT features — value is max count, -1 = unlimited
  MAX_MEMBERS: 'max_members',
  MAX_INVITATIONS: 'max_invitations',
  STORAGE_GB: 'storage_gb',
  MAX_DOMAINS: 'max_domains',
  MAX_AI_REQUESTS: 'max_ai_requests',
  MAX_PRODUCTS: 'max_products',
  MAX_CATEGORIES: 'max_categories',
  // Variant matrix size per product (commerce W5). 0 = simple products only.
  MAX_VARIANTS_PER_PRODUCT: 'max_variants_per_product',
  // Max site languages a tenant may publish (dynamic_page multi-language).
  // Free baseline is 2 (enforced in-app); higher plans raise it, -1 = unlimited.
  MAX_LANGUAGES: 'max_languages',

  // Max saved dashboards a tenant may keep (dashboard boards). Free baseline is
  // enforced in-app; higher plans raise it, -1 = unlimited.
  MAX_DASHBOARD_BOARDS: 'max_dashboard_boards',
  // Max tenant-authored dashboard widgets; seeded/first-party ones never count.
  MAX_DASHBOARD_CUSTOM_WIDGETS: 'max_dashboard_custom_widgets',

  // BOOLEAN features — value is 'true' | 'false'
  CUSTOM_DOMAIN: 'custom_domain',
  API_ACCESS: 'api_access',
  SSO_LOGIN: 'sso_login',
  AUDIT_LOGS: 'audit_logs',
  AI_FEATURES: 'ai_features',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  PRIORITY_SUPPORT: 'priority_support',

  // Rate limit — requests per minute, -1 = unlimited
  API_RATE_LIMIT: 'api_rate_limit',

  // ===========================================================================
  // Billing-aware service gating keys (consumed by service layer in
  // AI / Mail / SMS / Storage / Webhook / API-key flows).
  // ---------------------------------------------------------------------------
  // BOOLEAN feature_* keys gate access to the capability itself.
  // LIMIT feature_*_quota / feature_*_monthly_* keys gate per-period usage and
  // are checked against the matching TenantUsage counter (Redis-backed).
  // ===========================================================================

  // AI
  FEATURE_AI_CHAT: 'feature_ai_chat',
  FEATURE_AI_MONTHLY_TOKENS: 'feature_ai_monthly_tokens',

  // Mail
  FEATURE_EMAIL_SEND: 'feature_email_send',
  FEATURE_EMAIL_MONTHLY_QUOTA: 'feature_email_monthly_quota',

  // SMS
  FEATURE_SMS_SEND: 'feature_sms_send',
  FEATURE_SMS_MONTHLY_QUOTA: 'feature_sms_monthly_quota',

  // Storage
  FEATURE_STORAGE_UPLOAD: 'feature_storage_upload',
  FEATURE_STORAGE_QUOTA_BYTES: 'feature_storage_quota_bytes',

  // Webhook
  FEATURE_WEBHOOKS: 'feature_webhooks',

  // API Key
  FEATURE_API_KEYS: 'feature_api_keys',

  // Invoicing / e-invoicing
  FEATURE_INVOICING: 'feature_invoicing',

  // Gift cards
  FEATURE_GIFT_CARDS: 'feature_gift_cards',

  // Integrations hub (third-party connectors)
  FEATURE_INTEGRATIONS: 'feature_integrations',

  // Multi-warehouse source selection (commerce W6). Closed plans still
  // allocate — from ONE site — so a downgrade never breaks reservations.
  FEATURE_MULTI_WAREHOUSE: 'feature_multi_warehouse',

  // Automatic / BOGO / tiered promotion rules (commerce W4). The plain
  // shipped coupon code is DELIBERATELY ungated — gating a live feature to a
  // plan would be a regression; only rule-bearing coupons are covered.
  FEATURE_PROMOTION_RULES: 'feature_promotion_rules',

  // Public Google/Meta shopping feeds (commerce W7 §2.4). A boolean rather than
  // a module key: feeds are a sub-feature of an INSTALLED commerce_catalog,
  // which is what §6.1/1 reserves a fresh `feature_*` for.
  FEATURE_PRODUCT_FEEDS: 'feature_product_feeds',

  // New sales orders per calendar month (commerce W7 §6). A LIMIT, not a
  // boolean: it caps the VOLUME of the sales path and never its mechanism —
  // a tenant at the ceiling can still pay, ship and refund what they already
  // sold. Undeclared means unlimited, so it breaks no existing tenant.
  MAX_ORDERS_MONTHLY: 'max_orders_monthly',

  // How many price lists a tenant may DEFINE (commerce W3 §7). A LIMIT on the
  // authoring surface only: it can never switch price RESOLUTION off, because a
  // tenant whose plan lapsed must keep selling at the prices they already
  // published — a downgrade that silently repriced a catalogue overnight would
  // be the worst kind of billing side effect. Undeclared means unlimited.
  MAX_PRICE_LISTS: 'max_price_lists',

  // Telephony (docs/phases/18-telephony/05-security-kvkk.md §"feature_gate anahtarları").
  // Whether the plan includes telephony at all — checked once, at seat and
  // number creation (the two points somebody first touches the module).
  FEATURE_TELEPHONY: 'feature_telephony',
  // `telephony_agents` rows for the tenant (a seat is the licensing unit, not
  // a member — see `TelephonyAgentService`). Undeclared means unlimited.
  MAX_TELEPHONY_SEATS: 'max_telephony_seats',
  // `telephony_numbers` rows for the tenant. Undeclared means unlimited.
  MAX_TELEPHONY_NUMBERS: 'max_telephony_numbers',

  // Automation (docs/phases/08-automation/10-security-limits-metering.md §10.4, OD-94).
  // One count per tenant across every host (AD-8), never one per host. Each
  // check site states its own failure policy; undeclared means unlimited.
  // Flows of kind `flow`, checked at create, import and deploy (fails open).
  MAX_FLOWS: 'max_flows',
  // `logic.script` nodes across the deployed flows, checked at deploy (fails closed).
  MAX_SCRIPT_BLOCKS: 'max_script_blocks',
  // A VALUE, not a count: script CPU per message in ms (default 50, platform
  // max 200), read per script batch and cached 60 s.
  SCRIPT_CPU_MS: 'script_cpu_ms',
  // Dead letters a tenant's automation DLQ keeps (default 10 000, ceiling 100 000).
  MAX_DLQ_ENTRIES: 'max_dlq_entries',
  // Messages the generic automation host accepts per calendar month (OD-60):
  // the `automationMessages` tenant_usage metric. The root tenant is never limited.
  MAX_AUTOMATION_MESSAGES_MONTHLY: 'max_automation_messages_monthly',
  // A VALUE, not a count: the most minutes a flow's debug level `all` may last
  // (08 §8.2, AD-8). Default 15 when the plan has none, at least 1, at most 60;
  // unlimited (-1) means the platform's 60. Read where the level is set (the
  // `PUT debug/level` route and the worker's clamp) and shown by `GET debug/level`.
  AUTOMATION_DEBUG_MAX_MINUTES: 'automation_debug_max_minutes',
  // The flow protections of 08-automation/14 (FP-5, 9, 10, 11, 13, 19). Each is a VALUE with a
  // safe default, a floor and a ceiling (`automation/server/engine/guards.ts`): a plan may loosen
  // a guard, never remove it, and unlimited (-1) means the loose end: the floor for the minimum
  // interval and the dedupe window (shorter is looser), the ceiling for the rest.
  // The shortest inject repeat in seconds (default 60, 1..3600): refused at deploy, clamped at run time.
  AUTOMATION_MIN_INTERVAL_SECONDS: 'automation_min_interval_seconds',
  // Runs a minute of one flow before it pauses itself as "loop suspected" (default 6000).
  AUTOMATION_FLOW_MAX_RUNS_PER_MINUTE: 'automation_flow_max_runs_per_minute',
  // Failed runs in a row of one flow before it pauses itself as "failing" (default 100).
  AUTOMATION_FLOW_MAX_CONSECUTIVE_FAILURES: 'automation_flow_max_consecutive_failures',
  // Runs of one flow at once (default 16); the rest queue, at most 1000, the oldest dropped.
  AUTOMATION_FLOW_MAX_CONCURRENCY: 'automation_flow_max_concurrency',
  // Messages one node may send for one input (default 100); the rest are dropped and counted.
  AUTOMATION_MAX_FANOUT: 'automation_max_fanout',
  // Seconds a queued message lives before it is dropped unprocessed (default 300); a device message still enters its root flow.
  AUTOMATION_MESSAGE_TTL_SECONDS: 'automation_message_ttl_seconds',
  // Seconds a device message id (or content hash) is remembered to drop a repeat (default 60, 1..3600; unlimited is 1).
  AUTOMATION_DEDUPE_WINDOW_SECONDS: 'automation_dedupe_window_seconds',
  // Commands one device may get from flows in a sliding minute (08/14 FP-16, default 30, 1..600): the rest are refused and
  // counted, so a loop that toggles a relay, a valve or a motor cannot wear it out.
  AUTOMATION_DEVICE_COMMANDS_PER_MINUTE: 'automation_device_commands_per_minute',
  // Seconds the same notification (a flow's reason) to the same recipient is held back after one went out (08/14 FP-17,
  // default 600, 60..86400; shorter is looser, so unlimited is 60): an alarm storm sends one mail or SMS, the rest are counted.
  AUTOMATION_NOTIFY_COOLDOWN_SECONDS: 'automation_notify_cooldown_seconds',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

// ============================================================================
// Module / bundle entitlement key convention (phases/monetization/2.md).
// Used to express "this plan/product grants module X / bundle Y" in a way that
// slots into the existing feature-key system.
// ============================================================================

/** Entitlement key for a single module, e.g. moduleFeatureKey('accounting') → 'module:accounting'. */
export const moduleFeatureKey = (moduleId: string): string => `module:${moduleId}`;

/** Entitlement key for a bundle/product, e.g. bundleFeatureKey('commerce') → 'bundle:commerce'. */
export const bundleFeatureKey = (bundleKey: string): string => `bundle:${bundleKey}`;
