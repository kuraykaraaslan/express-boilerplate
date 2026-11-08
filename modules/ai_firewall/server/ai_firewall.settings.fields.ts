import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Settings -> AI firewall (/admin/settings/ai-firewall, 01 §1.1). Each key is read by ai_firewall.settings-policy.ts.
// The per-action modes (`aiFirewallMode:<actionId>`) are not fields here: they belong to the actions catalogue (01 §1.8), where every
// switch to Auto is confirmed.
export const AI_FIREWALL_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'aiFirewallKillSwitch',
    label: 'Stop the firewall\'s actions in this workspace',
    description: 'While on, the firewall only observes here: it proposes nothing and runs nothing on its own. Security events are still recorded, and sign-in lockouts, address bans and step-up work as before.',
    group: 'Kill switch',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'aiFirewallPlatformKillSwitch',
    label: 'Stop the firewall\'s actions in every workspace',
    description: 'The platform\'s kill switch: while on, the firewall only observes in every workspace of the installation, whatever each workspace chose.',
    group: 'Kill switch',
    type: 'boolean',
    defaultValue: 'false',
    rootOnly: true,
  },
  {
    key: 'aiFirewallDefaultMode',
    label: 'Mode of an action you have not set',
    description: 'Observe records what an action would have done; Suggest puts it in the approval queue for a person to decide. Automatic runs are switched on one action at a time, never as the default.',
    group: 'Actions',
    type: 'select',
    options: [
      { value: 'observe', label: 'Observe' },
      { value: 'suggest', label: 'Suggest' },
    ],
    defaultValue: 'observe',
  },
  {
    key: 'aiFirewallSignupHardBlock',
    label: 'Allow the firewall to block sign-ups from a network',
    description: 'Off: sign-up protection stays soft (a new account waits for its e-mail verification, a security check, or an administrator\'s review). On: the firewall may also refuse new sign-ups from one address for a while. Existing accounts and sign-ins are never blocked by this.',
    group: 'Sign-up protection',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'aiFirewallRetentionDays',
    label: 'Keep security events for (days)',
    description: 'Stored security events, closed incidents and finished actions older than this are deleted every night: 7 to 365 days.',
    group: 'Retention',
    type: 'number',
    defaultValue: '90',
    placeholder: '90',
  },
];
