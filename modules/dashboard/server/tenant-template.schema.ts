import { z } from 'zod'
import type { MigrationOp } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/types'
import type { TenantMigrationStep } from './tenant-template'

/**
 * 7a: the template line (`settingsTemplate` + `settingsMigrations`) a widget package carries, parsed as
 * untrusted input. Kept out of `tenant-template.ts`, which the browser imports and must stay zod-free.
 *
 * Every shape is strict, and the line as a whole is capped (size, version). The steps must be contiguous (`migrate` throws on a gap, which would
 * fail every board read of the widget), the op vocabulary is the engine's declarative one (no `up`, an
 * unknown op is refused), `each` nests at most three deep, and a key can never be `__proto__`,
 * `constructor` or `prototype` (`applyOp` assigns `v[op.to]` on a plain object) or start with `$`
 * (the platform's namespaces). Nothing else is capped per item (key length, option counts, ops per step):
 * a publish writes ops sized from the author's schema, and every line it writes must import (the publish
 * runs this parser on the line it is about to store, and refuses one that fails).
 */

export const TENANT_LINE_MAX_BYTES = 256 * 1024
export const TENANT_LINE_MAX_VERSION = 1000
const MAX_EACH_DEPTH = 3

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
/**
 * A key a step may name: never a prototype name, nor a `$` key (a platform namespace, `$card`, `$format`,
 * `$v`: a step that wrote one would bypass its validation). The widget DTO refuses the same field keys, so
 * a publish never derives an op this refuses.
 */
export const isStepKey = (k: string) => !RESERVED_KEYS.has(k) && !k.startsWith('$')
const Key = z.string().min(1).refine(isStepKey, 'reserved key')
const OptionValue = z.string()
const OptionList = z.array(OptionValue)

/** The op union at nesting `depth` (top level 1); `each` takes ops one level down, and below level 3 there is no `each`. */
function opSchema(depth: number): z.ZodType<MigrationOp> {
  const flat = [
    z.object({ op: z.literal('rename'), from: Key, to: Key }).strict(),
    z.object({ op: z.literal('mapValue'), key: Key, map: z.record(OptionValue.refine((k) => !RESERVED_KEYS.has(k), 'reserved key'), z.unknown()), else: z.unknown().optional() }).strict(),
    z.object({ op: z.literal('materializeDefault'), key: Key, value: z.unknown() }).strict(),
    z.object({ op: z.literal('clamp'), key: Key, min: z.number().finite().optional(), max: z.number().finite().optional() }).strict(),
    z.object({ op: z.literal('drop'), key: Key }).strict(),
    z.object({ op: z.literal('filterList'), key: Key, remove: OptionList.optional(), keep: OptionList.optional() }).strict(),
  ] as const
  if (depth > MAX_EACH_DEPTH) return z.discriminatedUnion('op', [...flat]) as unknown as z.ZodType<MigrationOp>
  const each = z.object({ op: z.literal('each'), key: Key, ops: z.array(opSchema(depth + 1)) }).strict()
  return z.discriminatedUnion('op', [...flat, each]) as unknown as z.ZodType<MigrationOp>
}

const StepSchema = z.object({
  from: z.number().int().min(1),
  to: z.number().int().min(2),
  note: z.string().max(500),
  ops: z.array(opSchema(1)).optional(),
  defaultChanges: z.array(z.object({
    key: Key, from: z.unknown(), to: z.unknown(), policy: z.enum(['preserve', 'propagate']),
  }).strict()).optional(),
}).strict()

export const TenantLineSchema = z.object({
  settingsTemplate: z.object({ id: z.string().max(200).startsWith('tenant:'), version: z.number().int().min(1).max(TENANT_LINE_MAX_VERSION) }).strict(),
  settingsMigrations: z.array(StepSchema).max(TENANT_LINE_MAX_VERSION - 1),
}).strict().superRefine((line, ctx) => {
  if (line.settingsMigrations.length !== line.settingsTemplate.version - 1) {
    ctx.addIssue({ code: 'custom', message: `version ${line.settingsTemplate.version} needs ${line.settingsTemplate.version - 1} step(s), got ${line.settingsMigrations.length}` })
  }
  line.settingsMigrations.forEach((s, i) => {
    if (s.from !== i + 1 || s.to !== s.from + 1) ctx.addIssue({ code: 'custom', message: `step ${i + 1} must go from ${i + 1} to ${i + 2}` })
  })
  if (JSON.stringify(line).length > TENANT_LINE_MAX_BYTES) ctx.addIssue({ code: 'custom', message: 'the settings template line is too large' })
})

export interface TenantLine {
  settingsTemplate: { id: string; version: number }
  settingsMigrations: TenantMigrationStep[]
}

/** The carried line, or why it is refused. */
export function parseTenantLine(raw: unknown): { ok: true; line: TenantLine } | { ok: false; reason: string } {
  const res = TenantLineSchema.safeParse(raw)
  if (!res.success) return { ok: false, reason: res.error.issues[0]?.message ?? 'invalid' }
  return { ok: true, line: res.data as TenantLine }
}
