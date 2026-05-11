import { z } from 'zod';

export const ThemeEnum = z.enum(['light', 'dark', 'system']);
export const LanguageEnum = z.enum(['en', 'tr', 'de', 'fr', 'es', 'ar', 'zh', 'ja']);

export type Theme = z.infer<typeof ThemeEnum>;
export type Language = z.infer<typeof LanguageEnum>;
