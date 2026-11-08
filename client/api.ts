// Browser bundle (public/js/kui-api.js, built by scripts/build-client.mjs): the same API client NB's pages use (CSRF mint and replay,
// token refresh queue, login redirects) and the helpers the sign-in pages share, exposed as window.Kui.
import api from '@kuraykaraaslan-labs/common/server/axios';
import { tenantPath, switchTenantPath, splitTenantBase, tenancyMode } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { isRootTenant, ROOT_TENANT_ID, tenantLabelProblem } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AuthUiError, authErrorText, authErrorCodes, isRateLimited, VALIDATION_ISSUES } from '@kuraykaraaslan-labs/auth/ui/auth-error';

(window as unknown as { Kui: unknown }).Kui = {
  api, tenantPath, switchTenantPath, splitTenantBase, tenancyMode, isRootTenant, ROOT_TENANT_ID, tenantLabelProblem,
  AuthUiError, authErrorText, authErrorCodes, isRateLimited, VALIDATION_ISSUES,
};
