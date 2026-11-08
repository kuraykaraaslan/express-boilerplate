// The platform's default-module list (docs/phases/25-marketplace/03-module-governance/01):
// which modules every NEW tenant starts with. Stored as the ROOT setting
// `platformDefaultModules` and always read with the ROOT id, so a tenant's own
// copy of the key (the generic settings API lets an admin write one) is never
// consulted. Installing the list is the service's `applyDefaultModules`.

import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { isPlatformOnlyModule } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import { isInstallableModule } from './module-lifecycle.helpers';

export const PLATFORM_DEFAULT_MODULES_KEY = 'platformDefaultModules';

const parse = (raw: string | null | undefined): string[] =>
  [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];

/** The configured list, minus ids that are no longer installable (a module removed from the build). */
export async function getPlatformDefaultModules(): Promise<string[]> {
  const raw = await SettingService.getValue(ROOT_TENANT_ID, PLATFORM_DEFAULT_MODULES_KEY);
  return parse(raw).filter((id) => isInstallableModule(id) && !isPlatformOnlyModule(id));
}

/** Every id must be a known, tenant-installable module; duplicates collapse. Throws 400 naming the bad ids. */
export function validateDefaultModules(ids: string[]): string[] {
  const list = [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  const bad = list.filter((id) => !isInstallableModule(id) || isPlatformOnlyModule(id));
  if (bad.length) {
    throw new AppError(
      `Not tenant-installable modules: ${bad.join(', ')}. Core modules are always on; operator-only modules never reach a tenant.`,
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }
  return list;
}

export async function setPlatformDefaultModules(ids: string[], actorId?: string): Promise<string[]> {
  const list = validateDefaultModules(ids);
  await SettingService.updateMany(ROOT_TENANT_ID, { [PLATFORM_DEFAULT_MODULES_KEY]: list.join(',') }, actorId ? { actorId } : undefined);
  return list;
}
