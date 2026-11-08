// `common:provider_scope` (docs/phases/53-setting-levels, 53.4): whose installed plugin providers serve a tenant at a host point,
// from the setting level of the module that owns the point (its module.json level `points`). `platform` is the root tenant's
// installs, `tenant` the tenant's own, `tenant_first` the tenant's own when one is configured, else the root tenant's. A point no
// level covers gets no answer, and the bridge keeps the tenant's own.

import type { ProviderScope, ProviderScopeSource } from '@kuraykaraaslan-labs/common/server/external-extensions';
import { SETTING_LEVELS_BY_MODULE } from '@kuraykaraaslan-labs/common/server/setting-keys.catalog';
import { getSettingLevel } from './tenant_setting.read.service';

const POINT_MODULE = new Map<string, string>(
  Object.entries(SETTING_LEVELS_BY_MODULE).flatMap(([moduleId, level]) => level.points.map((point) => [point, moduleId] as const)),
);

const SCOPE_OF_LEVEL = { platform: 'root', tenant: 'own', tenant_first: 'own_then_root' } as const satisfies Record<string, ProviderScope>;

const source: ProviderScopeSource = {
  async scope(tenantId, point) {
    const moduleId = POINT_MODULE.get(point);
    if (!moduleId) return null;
    const level = await getSettingLevel(tenantId, moduleId);
    return level ? SCOPE_OF_LEVEL[level.level] : null;
  },
};

export default source;
