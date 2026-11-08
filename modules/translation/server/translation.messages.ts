export const TranslationMessages = {
  INVALID_LOCALE: 'Invalid language code',
  INVALID_MODULE: 'Invalid module id',
  INVALID_KEY: 'Invalid translation key',
  KEY_OUTSIDE_MODULE: 'The key must start with its module id',
  EMPTY_VALUE: 'A text cannot be empty; delete it to fall back to the dictionary',
  VALUE_TOO_LONG: 'The text is too long',
  UNKNOWN_MODULE: 'Unknown module',
  UNKNOWN_LANGUAGE: 'Unknown language',
  LANGUAGE_NOT_ENABLED: 'This language is not enabled',
} as const;

/** The GUEST permission both public routes check (module.json `permissions`). */
export const READ_PUBLIC_PERMISSION = 'translation.languages.read_public';
/** The system-level admin API (GLOBAL scope): read, and write (save, delete, import). */
export const TEXTS_READ_PERMISSION = 'translation.texts.read';
export const TEXTS_MANAGE_PERMISSION = 'translation.texts.manage';
