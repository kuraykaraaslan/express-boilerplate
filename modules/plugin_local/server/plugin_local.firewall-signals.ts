/**
 * plugin_local's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): local plugin versions
 * uploaded (or registered as built in), approved with their sandbox grant and yanked; a plugin disabled or enabled for the platform;
 * the platform's trust policy changed (trusted signing key ids, signed bundles required, sandbox limits); a plugin installed, activated,
 * deactivated, uninstalled (its rows and files purged) and configured (its secrets set or cleared) in a workspace. The version, plugin
 * or trust policy is the row's subject; no person is in the metadata (names, versions, digests, key ids, counts, a yank reason the
 * operator wrote). The actor is the operator or administrator, or the system (`npm run storage:local`). The trust policy decides which
 * signers' code runs: the heaviest kind; an approval lets code run, a secret written, an install or purge and a platform-wide switch are
 * medium; turning an installed plugin on or off is a status change. Arrays and objects (the settings and secret names, the approved
 * grant, the key id list) never travel on a signal and are not declared. Only the contract from common is imported (ADR-0008 §2).
 */
import { auditRowSignal, signalAttr as a, type FirewallSignalContribution } from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const ACTORS = ['user', 'anon'] as const;
const SCOPED = { scopedName: a.untrusted('none', 'the plugin name') };
const VERSION = { pluginId: a.untrusted('none'), version: a.untrusted('none', 'the version label') };

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'plugin_local.version.upload', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...VERSION, ...SCOPED, bundleSha256: a.untrusted('none', 'the bundle digest'), signerKid: a.untrusted('none', 'the signing key id, never the key'), builtin: a.flag() },
  }),
  auditRowSignal({ kind: 'plugin_local.version.approve', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS], metadata: VERSION }),
  auditRowSignal({
    kind: 'plugin_local.version.yank', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...VERSION, reason: a.untrusted('content', 'the reason the operator wrote') },
  }),
  auditRowSignal({ kind: 'plugin_local.plugin.disable', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: SCOPED }),
  auditRowSignal({ kind: 'plugin_local.plugin.enable', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS], metadata: SCOPED }),
  // which signing keys the platform trusts: the anchor every local plugin's signature is checked against
  auditRowSignal({
    kind: 'plugin_local.trust.update', severity: 'medium', defaultWeight: 0.4, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { requireSigned: a.flag(), maxLimits: a.untrusted('none', 'the sandbox limits, as JSON') },
  }),
  auditRowSignal({
    kind: 'plugin_local.install', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...SCOPED, versionId: a.untrusted('none'), version: a.untrusted('none') },
  }),
  auditRowSignal({ kind: 'plugin_local.activate', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { versionId: a.untrusted('none') } }),
  auditRowSignal({ kind: 'plugin_local.deactivate', severity: 'low', defaultWeight: 0.1, outcomes: ['info'], actorKinds: [...ACTORS], metadata: { versionId: a.untrusted('none') } }),
  auditRowSignal({
    kind: 'plugin_local.uninstall', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: [...ACTORS],
    metadata: { ...SCOPED, rowsPurged: a.number(), filesPurged: a.number() },
  }),
  // the settings and the secret names travel as arrays (never on a signal); a secret value is never in the row
  auditRowSignal({ kind: 'plugin_local.configure', severity: 'medium', defaultWeight: 0.3, outcomes: ['info'], actorKinds: [...ACTORS] }),
];

export default SIGNALS;
