import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for the profile settings page (/admin/settings/profiles). Every key is read per tenant: the name and
// custom-field lists by user_profile.helpers.ts, the moderation keys by user_profile.moderation.service.ts. Unset keeps
// the old behaviour: only the global reserved names, any custom field, no moderation, threshold 0.6. The `generic`
// moderation provider and its URL are not offered here (see user_profile.setting.keys.ts).
export const USER_PROFILE_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'reservedDisplayNames',
    label: 'Reserved display names',
    description:
      'Comma-separated names nobody in this organization may take as a display name, on top of the built-in ones (admin, support, owner, ...). Matched without case.',
    group: 'Display names',
    type: 'textarea',
    placeholder: 'ceo, hr, it-helpdesk',
  },
  {
    key: 'profileCustomFields',
    label: 'Allowed custom fields',
    description:
      'Comma-separated custom profile field names a member may save. A field outside the list is refused. Empty = any field.',
    group: 'Custom fields',
    type: 'textarea',
    placeholder: 'department, employeeId',
  },
  {
    key: 'avatarModerationProvider',
    label: 'Image moderation',
    description:
      'Checks a new avatar or header image with the provider and refuses it when flagged. If the provider cannot be reached the image is allowed.',
    group: 'Image moderation',
    type: 'select',
    options: [
      { value: '', label: 'Off' },
      { value: 'sightengine', label: 'Sightengine' },
    ],
    defaultValue: '',
  },
  {
    key: 'avatarModerationApiUser',
    label: 'Sightengine API user',
    description: 'The api_user of the Sightengine account.',
    group: 'Image moderation',
    type: 'text',
  },
  {
    key: 'avatarModerationApiKey',
    label: 'Sightengine API secret',
    description: 'The api_secret of the Sightengine account. Stored encrypted.',
    group: 'Image moderation',
    type: 'secret',
  },
  {
    key: 'avatarModerationThreshold',
    label: 'Flag threshold',
    description: 'A score from 0.01 to 1 at or above which an image is refused. Lower refuses more. Anything else reads as 0.6.',
    group: 'Image moderation',
    type: 'number',
    defaultValue: '0.6',
    placeholder: '0.6',
  },
];
