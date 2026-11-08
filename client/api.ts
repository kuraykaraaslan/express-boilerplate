// Browser bundle (public/js/kui-api.js, built by scripts/build-client.mjs): the same API client NB's pages use (CSRF mint and replay,
// token refresh queue, login redirects) and the helpers the sign-in pages share, exposed as window.Kui.
import api from '@kuraykaraaslan-labs/common/server/axios';
import { tenantPath } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { AuthUiError, authErrorText, VALIDATION_ISSUES } from '@kuraykaraaslan-labs/auth/ui/auth-error';

(window as unknown as { Kui: unknown }).Kui = { api, tenantPath, AuthUiError, authErrorText, VALIDATION_ISSUES };
