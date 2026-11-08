import { z } from 'zod'

/**
 * A PATCH schema from a create schema: every field optional, and **no
 * defaults**.
 *
 * zod 4 keeps a field's `.default()` through `.partial()`, so
 * `CreateX.partial().parse({})` is not `{}`. It is every defaulted field set
 * to its default. A PATCH that changed one field therefore reset all the
 * others. A 2026-09-25 scan measured this by parsing `{}` through every
 * exported Update schema: ~95 schemas across 50 modules filled fields in.
 * Among them:
 * - `UpdatePageDTO` wrote `slug: ''`, `sections: []`, `status: 'DRAFT'`;
 * - `UpdateProductDTO` wrote `status: 'DRAFT'`;
 * - `UpdateOrderDTO` wrote `status: 'DRAFT'`, `grandTotalMinor: '0'`;
 * - `UpdatePlanDTO` wrote `status: 'ACTIVE'`, `trialDays: 0`.
 * Toggling one flag unpublished, zeroed or reset the rest of the row.
 *
 * `patchSchema(CreateX)` unwraps each top-level `optional`/`default`/
 * `prefault` to the inner type and makes it optional, so an absent field stays
 * absent and the service leaves the column alone. Nested defaults inside a
 * present object or array element are kept: those describe a value the
 * caller did send. `.extend(...)` on the result works as usual.
 */

type Unwrap<S> =
  S extends z.ZodOptional<infer I> ? Unwrap<I>
    : S extends z.ZodDefault<infer I> ? Unwrap<I>
      : S extends z.ZodPrefault<infer I> ? Unwrap<I>
        : S

export type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<Unwrap<T[K]> & z.ZodType> }

function unwrap(schema: z.ZodType): z.ZodType {
  let s = schema
  for (;;) {
    const type = (s as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def.type
    if (type === 'optional' || type === 'default' || type === 'prefault') {
      s = (s as unknown as { _zod: { def: { innerType: z.ZodType } } })._zod.def.innerType
      continue
    }
    return s
  }
}

export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.ZodObject<PatchShape<T>> {
  const shape: Record<string, z.ZodType> = {}
  for (const [key, field] of Object.entries(schema.shape)) shape[key] = unwrap(field as z.ZodType).optional()
  return z.object(shape) as unknown as z.ZodObject<PatchShape<T>>
}
