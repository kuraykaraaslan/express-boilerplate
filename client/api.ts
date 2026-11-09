// Browser bundle (public/js/kui-api.js, built by scripts/build-client.mjs): the same API client NB's pages use (CSRF mint and replay,
// token refresh queue, login redirects) and the helpers the sign-in pages share, exposed as window.Kui.
import api from '@kuraykaraaslan-labs/common/server/axios';
import { tenantPath, switchTenantPath, splitTenantBase, tenancyMode } from '@kuraykaraaslan-labs/common/server/tenant-path';
import { isRootTenant, ROOT_TENANT_ID, tenantLabelProblem } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withStepUp, isStepUpCancelled, StepUpCancelled } from '@kuraykaraaslan-labs/auth/ui/step-up.client';
import { startAuthentication } from '@simplewebauthn/browser';
import { AuthUiError, authErrorText, authErrorCodes, isRateLimited, VALIDATION_ISSUES } from '@kuraykaraaslan-labs/auth/ui/auth-error';

(window as unknown as { Kui: unknown }).Kui = {
  api, tenantPath, switchTenantPath, splitTenantBase, tenancyMode, isRootTenant, ROOT_TENANT_ID, tenantLabelProblem,
  withStepUp, isStepUpCancelled, StepUpCancelled, startAuthentication,
  AuthUiError, authErrorText, authErrorCodes, isRateLimited, VALIDATION_ISSUES,
};
