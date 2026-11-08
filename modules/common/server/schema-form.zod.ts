import { z } from 'zod'
import type { FieldSchema } from './schema-form.types'

/**
 * A Zod validator for a `FieldSchema` map.
 *
 * Needed because a settings object arrives from a browser and is stored as jsonb:
 * without a schema-derived check, "settings" is an unvalidated blob a caller can
 * put anything into. Unknown keys are STRIPPED rather than rejected — a widget
 * whose schema lost a field should not make every board carrying it unsaveable.
 *
 * Only the shapes the store has to trust are modelled; the field components own
 * presentation. Anything richer (a `link`, a `background`, a `media` object)
 * passes through as unknown, because those are validated by the renderer that
 * produced them and re-describing them here would be a second source of truth.
 */
export function zodFromSchema(schema: Record<string, FieldSchema>): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, field] of Object.entries(schema)) {
    shape[key] = fieldValidator(field).optional()
  }
  return z.object(shape).strip() as unknown as z.ZodType<Record<string, unknown>>
}

function fieldValidator(field: FieldSchema): z.ZodTypeAny {
  switch (field.type) {
    case 'boolean':
      return z.boolean()
    case 'number': {
      let n = z.number()
      if (field.min !== undefined) n = n.min(field.min)
      if (field.max !== undefined) n = n.max(field.max)
      return n
    }
    case 'select': {
      const values = (field.options ?? []).map((o) => (typeof o === 'string' ? o : o.value))
      // An option list that is loaded at runtime leaves `options` empty; a string
      // is then the most that can honestly be asserted.
      return values.length ? z.enum(values as [string, ...string[]]) : z.string()
    }
    case 'multi-select':
      return z.array(z.string())
    case 'repeater':
      return z.array(z.unknown())
    case 'text':
    case 'textarea':
    case 'rich-text':
    case 'url':
    case 'color':
    case 'color-token':
    case 'icon':
    case 'datetime':
    case 'date':
    case 'symbol':
    case 'remote-select':
      return z.string()
    default:
      // json, img, media, link, background: compound values whose shape belongs to
      // the field component that produced them.
      return z.unknown()
  }
}
