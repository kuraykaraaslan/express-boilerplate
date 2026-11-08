/**
 * The MCP revision this server is built against, and the transport limits (docs/phases/57-mcp-server D57-3, D57-10; ADR-0022).
 *
 * BUILD_TARGET_REVISION is the ONE date literal of this module (gate P1). It is never asserted at boot (F21): the CI drift test
 * (tests/mcp_server.protocol-drift.test.ts) fails the build when the installed SDK's LATEST_PROTOCOL_VERSION moves away from it.
 */
export const BUILD_TARGET_REVISION = '2025-11-25';

/** MCP requests are small: a tool name and a few arguments. */
export const MAX_MCP_BODY_BYTES = 64 * 1024;
/** A tool result larger than this is refused as truncated (F17): a tool pages instead. */
export const MAX_MCP_RESULT_BYTES = 256 * 1024;
/** Foreign text per fenced block (tool-definition-and-output.md §4.4 U3). */
export const MAX_FOREIGN_BYTES = 32 * 1024;
/** A tool's time budget; its abort signal fires at this point. */
export const MCP_TOOL_TIMEOUT_MS = 10_000;
/** Per credential and kind, per minute (fixed window through the shared limiter). */
export const MCP_READ_PER_MINUTE = 120;
export const MCP_WRITE_PER_MINUTE = 20;

/** The permission a credential needs to reach any MCP server of the tenant (D57-9, D57-15): an API key holds it only when someone ticked it. */
export const MCP_CONNECT_PERMISSION = 'mcp_server.connect';

/** Code_Structure_Rules_TS redis-and-bullmq.md: how long an idempotency key holds its first result (gate R1). */
export const IDEMPOTENCY_KEY_TTL = 86400;

/** A write scope is consented to only right after a sign-in (D57-8). */
export const WRITE_CONSENT_MAX_SESSION_AGE_MS = 15 * 60 * 1000;

export const MCP_SERVER_VERSION = '0.2.0';
