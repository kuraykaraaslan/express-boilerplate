import { z } from 'zod';
import { TRANSLATION_PLATFORMS } from './translation.types';
import { TranslationMessages as M } from './translation.messages';

// Locale and module end up inside Redis keys (`i18n:msg:<locale>:<module>:<platform>`),
// so both are restricted to characters that cannot forge a key segment.

/**
 * Language with at most one subtag, lowercased: `bg`, `pt-br`. The mobile app's schema
 * accepts exactly this shape and rejects the WHOLE languages list when one code does not
 * fit, so a code like `zh-hant-tw` is neither stored nor offered.
 */
export const LocaleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, M.INVALID_LOCALE)
  .max(16, M.INVALID_LOCALE);

/** A module id, as in module.json. */
export const ModuleIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, M.INVALID_MODULE)
  .max(64, M.INVALID_MODULE);

/** `<module>.<area>.<slug>`; segments after the module may use camelCase and dashes. */
export const KeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[A-Za-z0-9_-]+)+$/, M.INVALID_KEY)
  .max(255, M.INVALID_KEY);

export const PlatformSchema = z.enum(TRANSLATION_PLATFORMS).nullable();

const RefShape = {
  locale: LocaleSchema,
  module: ModuleIdSchema,
  platform: PlatformSchema,
  key: KeySchema,
};

const keyBelongsToModule = (v: { module: string; key: string }) => v.key.startsWith(`${v.module}.`);

export const TranslationRefSchema = z
  .object(RefShape)
  .refine(keyBelongsToModule, { message: M.KEY_OUTSIDE_MODULE, path: ['key'] });

/** An empty text would blank the UI instead of falling back to the dictionary: delete the row instead. */
export const TranslationEntrySchema = z
  .object({ ...RefShape, value: z.string().min(1, M.EMPTY_VALUE).max(10_000, M.VALUE_TOO_LONG) })
  .refine(keyBelongsToModule, { message: M.KEY_OUTSIDE_MODULE, path: ['key'] });
