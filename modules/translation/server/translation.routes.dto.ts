import { z } from 'zod';
import { CLIENT_PLATFORMS } from './translation.platform';
import { ModuleIdSchema } from './translation.dto';

// Request shapes of the two guest routes, mirroring the mobile app's
// modules/localization/translation.dto.ts (expo-react-native-boilerplate).

/** GET …/localization/languages?platform= — optional: absent = versions over every row. */
export const LanguagesQuerySchema = z.object({
  platform: z.enum(CLIENT_PLATFORMS).optional(),
});

/** POST …/localization/languages/{code} body. */
export const BundleRequestSchema = z.object({
  platform: z.enum(CLIENT_PLATFORMS),
  module: ModuleIdSchema,
});
