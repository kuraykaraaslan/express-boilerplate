// GENERATED from modules/automation/server/engine/message.ts by scripts/gen-automation-contract.mjs. DO NOT EDIT: change the engine, then run
// `npm run gen:automation-contract`. Types only.
import { z } from 'zod';
/** Phase 01 §1.1. Limits as on the router: ≤ 256 KiB as JSON, hop limit 512 (DD-3). */
export declare const MAX_MSG_BYTES: number;
export declare const MAX_HOPS = 512;
export declare const MAX_TOPIC_LENGTH = 256;
export declare const USER_FIELD_NAME: RegExp;
/** Read-only on every host; hosts add their own via `systemMetadata` (03 §3.1). */
export declare const ENGINE_SYSTEM_METADATA: readonly [
    "correlationId",
    "redelivered",
    "automation"
];
/** Top-level fields a node, script or expression may never write. */
export declare const READONLY_MSG_FIELDS: readonly [
    "_msgid",
    "_run",
    "_hops",
    "msgType",
    "originator"
];
export interface EngineError extends Error {
    readonly code: string;
}
export declare const OriginatorSchema: z.ZodObject<{
    type: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
export declare const MsgErrorSchema: z.ZodObject<{
    message: z.ZodString;
    code: z.ZodString;
    source: z.ZodObject<{
        id: z.ZodString;
        type: z.ZodString;
        flow: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$loose>;
/** `logic.split` marks its parts; `logic.join` reads them back. Extra keys (`type`, `key`, `ch`, `len`, `parts`) pass through. */
export declare const MsgPartsSchema: z.ZodObject<{
    id: z.ZodString;
    index: z.ZodNumber;
    count: z.ZodNumber;
}, z.core.$loose>;
export declare const FlowMsgSchema: z.ZodObject<{
    _msgid: z.ZodString;
    _run: z.ZodString;
    _hops: z.ZodNumber;
    msgType: z.ZodString;
    payload: z.ZodUnknown;
    metadata: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    originator: z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, z.core.$strip>;
    topic: z.ZodString;
    parts: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        index: z.ZodNumber;
        count: z.ZodNumber;
    }, z.core.$loose>>;
    error: z.ZodOptional<z.ZodObject<{
        message: z.ZodString;
        code: z.ZodString;
        source: z.ZodObject<{
            id: z.ZodString;
            type: z.ZodString;
            flow: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>;
    }, z.core.$loose>>;
}, z.core.$loose>;
export type FlowMsg = z.infer<typeof FlowMsgSchema> & Record<string, unknown>;
export declare function msgByteSize(msg: unknown): number;
/**
 * True when `msg` surely serialises within `MAX_MSG_BYTES`: one walk of plain data adds an upper bound of each value's JSON in UTF-8
 * (a UTF-16 unit is at most 6 bytes, `\uXXXX`; a number at most 25 characters). False when the bound passes the limit or the walk
 * meets anything `JSON.stringify` might treat its own way (a `toJSON`, a class instance, a bigint, a value that is not an object):
 * then the exact size is measured, so every message gets the same answer, and the same error, as from `msgByteSize`.
 */
export declare function msgSurelyFits(msg: unknown): boolean;
/**
 * Throws `msg_too_big` above 256 KiB. Measured exactly only when the cheap bound cannot vouch for it: serialising every message on
 * every hop was ~4% of a busy IoT worker (load test 2026-10-23); the limit and its errors are the same.
 */
export declare function assertMsgSize(msg: unknown): void;
/**
 * Throws `readonly_field` when a write targets a read-only top-level field, an engine system metadata key or a
 * host-declared one. `path` is the dotted path after `msg.` (e.g. `metadata.correlationId`).
 */
export declare function assertWritable(path: string, hostSystemMetadata?: readonly string[]): void;
/** `assertWritable` for a path that is split already (a key with a dot in it, reached with brackets, stays one segment). */
export declare function assertWritableAt(segs: readonly (string | number)[], hostSystemMetadata?: readonly string[]): void;
/** A user-defined top-level field name must match the router's rule. Reserved fields are not user fields. */
export declare function isValidUserFieldName(name: string): boolean;
/** Nesting a user-defined top-level field may have; `payload` and `metadata` are bounded by the size cap only (§1.1). */
export declare const MAX_USER_FIELD_DEPTH = 8;
/**
 * Every write of a node, script or expression to a `msg` path goes through here (§1.1). `segs` is the path after
 * `msg.`, `value` what is written (`del`: removed). Throws `readonly_field` for a read-only field or a system metadata
 * key (the engine's and the host's `hostSystemMetadata`, also when `metadata` as a whole would drop or change one),
 * and `range` for a user field whose name breaks the router rule or whose value nests deeper than 8 levels, for a
 * topic above 256 characters and for a byte array.
 */
export declare function assertMsgWrite(msg: FlowMsg, segs: readonly (string | number)[], value: unknown, del: boolean, hostSystemMetadata?: readonly string[]): void;
/**
 * The same rules for a whole message the engine is about to route (§1.1): what a script, a contributed node or any
 * write that bypassed the node helpers left in it. Throws like `assertMsgWrite` (no read-only check: the engine owns
 * those fields), and `msg_too_big` above 256 KiB.
 */
export declare function assertMsgShape(msg: FlowMsg): void;
/** Cross-tenant check for `ctx.setOriginator` (§1.1): returns the new originator or throws `cross_tenant`. */
export declare function rewriteOriginator(original: {
    type: string;
    id: string;
}, next: {
    type: string;
    id: string;
    tenantId: string;
}, tenantId: string): {
    originator: {
        type: string;
        id: string;
    };
    original: {
        type: string;
        id: string;
    };
};
/**
 * Freezes a value and everything it holds, in place (01 §1.4 copy rule, test mode): a node declared `mutates: false` gets
 * its message through this in a test run, so a write to it throws instead of corrupting a sibling branch in production.
 */
export declare function deepFreeze<T>(v: T): T;
