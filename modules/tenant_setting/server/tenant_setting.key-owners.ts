// Setting keys that belong to another module's settings (docs/phases/45-install-config, the settings guard): the generic
// settings API (`/api/admin-settings`, `/api/settings`) serves and writes them only to a caller holding that module's
// permission too, the one its settings page is guarded by, so `tenant_setting.config.*` alone opens no module's
// settings and config/access.ts closes a module's settings page and its keys with one id.
//
// The ids and keys are written out, not imported: tenant_setting never imports the modules that require it. Each list
// is the owner's own `*.setting.keys.ts` declaration; tests/tenant_setting.key-owners.test.ts fails when one drifts.

export interface SettingKeyOwner {
  /** The module whose settings these are. */
  moduleId: string;
  /** Needed to read the keys: the guard of the owner's settings page, beside `tenant_setting.config.read`. */
  read: readonly string[];
  /** Needed, with `read`, to write or delete them, beside `tenant_setting.config.update` / `.delete`. */
  update: readonly string[];
  keys: readonly string[];
  /** Key families built at run time (`integrationsClientSecret:<connectorKey>`): every key starting with one is this owner's. */
  prefixes?: readonly string[];
}

export const SETTING_KEY_OWNERS: readonly SettingKeyOwner[] = [
  {
    // payment.setting.keys.ts PAYMENT_KEYS, PAYMENT_POLICY_KEYS and TENANT_BILLING_KEYS: Settings → Billing and
    // Payments → Settings, both guarded by payment's own read permission (the Payments menu item's); a write also needs
    // its update permission, so a read-only payment role changes no payment setting here.
    moduleId: 'payment',
    read: ['payment.payments.read'],
    update: ['payment.payments.update'],
    keys: [
      'stripeEnabled', 'stripePublicKey', 'stripeSecretKey', 'stripeWebhookSecret', 'stripePublishableKey', 'stripeConnectSecretKey',
      'paypalEnabled', 'paypalClientId', 'paypalClientSecret', 'paypalSandboxMode', 'paypalWebhookId',
      'iyzicoEnabled', 'iyzicoApiKey', 'iyzicoSecretKey', 'iyzicoSandboxMode', 'iyzicoEnabledInstallments',
      'alipayEnabled', 'alipayAppId', 'alipayPrivateKey', 'alipayPublicKey', 'alipaySandboxMode',
      'wechatPayEnabled', 'wechatPayAppId', 'wechatPayMchId', 'wechatPayPrivateKey', 'wechatPaySerialNo', 'wechatPayApiV3Key', 'wechatPayNotifyUrl',
      'yookassaEnabled', 'yookassaShopId', 'yookassaSecretKey',
      'cloudpaymentsEnabled', 'cloudpaymentsPublicId', 'cloudpaymentsApiSecret',
      'adyenEnabled', 'adyenApiKey', 'adyenMerchantAccount', 'adyenClientKey', 'adyenHmacKey', 'adyenSandboxMode',
      'mollieEnabled', 'mollieApiKey', 'mollieProfileId',
      'razorpayEnabled', 'razorpayKeyId', 'razorpayKeySecret', 'razorpayWebhookSecret',
      'paytrEnabled', 'paytrMerchantId', 'paytrMerchantKey', 'paytrMerchantSalt', 'paytrTestMode',
      'manualEnabled', 'manualPaymentNote',
      'currency', 'taxRate', 'taxEnabled',
      'paymentDefaultProvider', 'paymentMaxChargeAmount', 'paymentMaxFailedAttempts', 'paymentSettlementCurrency', 'refundWindowDays',
      'billingEmail', 'billingName', 'billingAddress', 'taxId', 'vatNumber', 'invoicePrefix', 'invoiceFooter',
    ],
  },
  {
    // notification_mail.setting.keys.ts EMAIL_KEYS and NOTIFICATION_KEYS: Settings → Email and Settings → Notifications.
    moduleId: 'notification_mail',
    read: ['notification_mail.settings.read'],
    update: ['notification_mail.settings.update'],
    keys: [
      'mailProvider', 'fromEmail', 'fromName',
      'smtpHost', 'smtpPort', 'smtpUsername', 'smtpPassword', 'smtpEncryption', 'smtpSecure',
      'sendgridApiKey', 'mailgunApiKey', 'mailgunDomain', 'mailgunRegion',
      'awsSesAccessKeyId', 'awsSesSecretAccessKey', 'awsSesRegion', 'postmarkApiKey', 'resendApiKey',
      'vapidPublicKey', 'vapidPrivateKey', 'vapidContactEmail',
      'emailOnNewUser', 'emailOnNewComment', 'emailOnNewOrder', 'emailOnNewContact',
      'slackWebhookUrl', 'slackNotificationsEnabled', 'adminNotificationEmail',
    ],
  },
  {
    // notification_sms.setting.keys.ts SMS_KEYS: Settings → SMS.
    moduleId: 'notification_sms',
    read: ['notification_sms.settings.read'],
    update: ['notification_sms.settings.update'],
    keys: [
      'smsProvider', 'smsEnabled', 'smsAllowedCountries',
      'smsRegionProviderMap', 'smsRateLimitWindowSeconds', 'smsSenderIds', 'smsDltTemplateId', 'smsDefaultSenderId',
      'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber',
      'nexmoApiKey', 'nexmoApiSecret', 'nexmoPhoneNumber', 'clickatellApiKey',
      'netgsmUserCode', 'netgsmPassword', 'netgsmPhoneNumber',
      'verimorUsername', 'verimorPassword', 'verimorSourceAddr',
    ],
  },
  {
    // storage.setting.keys.ts STORAGE_KEYS, storage.scan.setting.keys.ts STORAGE_SCAN_KEYS and storage.local.setting.keys.ts STORAGE_LOCAL_KEYS (the local disk
    // provider's directory and floor, platform-only): Settings → Storage.
    moduleId: 'storage',
    read: ['storage.settings.read'],
    update: ['storage.settings.update'],
    keys: [
      'storageProvider', 's3Bucket', 's3Region', 's3AccessKey', 's3SecretKey', 's3Endpoint',
      'maxFileSizeMb', 'allowedExtensions', 'allowedMimeGroups', 'allowedMimeTypes', 'imageStripExif', 'storageLinkMaxTtlSeconds',
      'virusScanEnabled', 'virusScanMode', 'virusScanProvider', 'virusScanApiKey', 'virusScanTimeoutSeconds',
      'virusScanInfectedAction', 'virusScanQuarantineFolder',
      'storageLocalDir', 'storageLocalMinFreeMb',
    ],
  },
  // The module settings pages of 2026-10-27 (docs/audits/2026-10-27-module-settings-pages.md): each entry is its page's
  // guard and the update id of the module, the keys its `<module>.setting.keys.ts` z.enum.
  {
    // iot_device.setting.keys.ts: IoT → Devices → Settings.
    moduleId: 'iot_device',
    read: ['iot_device.devices.read'],
    update: ['iot_device.devices.update'],
    keys: ['iotDeviceIssueTokenOnCreate', 'iotDeviceChosenPasswordMinLength', 'iotDeviceMaxBindingsPerDevice', 'iotWebhookConnectionHysteresisSeconds', 'iotWebhookDeviceEventsPerMinute'],
  },
  {
    // iot_gateway.setting.keys.ts: the cloud SNMPv2c switch of IoT → Endpoints (route-only, MS-21; OD-78, D309).
    moduleId: 'iot_gateway',
    read: ['iot_gateway.endpoints.read'],
    update: ['iot_gateway.endpoints.manage'],
    keys: ['iotSnmpCloudV2cEnabled'],
  },
  {
    // iot_alarm.setting.keys.ts: IoT → Alarms → Settings.
    moduleId: 'iot_alarm',
    read: ['iot_alarm.read'],
    update: ['iot_alarm.rules.manage'],
    keys: ['iotAlarmCriticalBypassPreferences', 'iotAlarmStormThreshold', 'iotAlarmCriticalCeiling', 'iotAlarmHistoryDays', 'iotAlarmRepeatWindowSec'],
  },
  {
    // iot_rpc.setting.keys.ts: IoT → Commands → Settings (linked from a device's Commands tab).
    moduleId: 'iot_rpc',
    read: ['iot_rpc.read'],
    update: ['iot_rpc.commands.manage'],
    keys: ['iotRpcHistoryDays', 'iotRpcDevicePerMinute', 'iotRpcTenantPerMinute'],
  },
  {
    // iot_provisioning.setting.keys.ts: IoT → Quarantine → Settings; the module has no other fitting id.
    moduleId: 'iot_provisioning',
    read: ['iot_provisioning.quarantine.activate'],
    update: ['iot_provisioning.quarantine.activate'],
    keys: ['iotProvisioningQuarantineReportDays'],
  },
  {
    // commerce_review.setting.keys.ts: Reviews → Settings.
    moduleId: 'commerce_review',
    read: ['commerce_review.reviews.read'],
    update: ['commerce_review.reviews.update'],
    keys: ['reviewRequireVerifiedPurchase', 'reviewAutoApprove', 'reviewVerifiedPurchaseStatuses'],
  },
  {
    // commerce_shipping.setting.keys.ts: Shipping Methods → Settings (the rules keys), the carrier credentials the
    // adapters read, which no page shows, and the carrier allowlist fulfillment delegates to (MS-02).
    moduleId: 'commerce_shipping',
    read: ['commerce_shipping.methods.read'],
    update: ['commerce_shipping.methods.update'],
    keys: [
      'shippingHandlingFee', 'shippingFuelSurchargePercent', 'shippingDimDivisor', 'shippingMaxPackageWeightKg',
      'shippingProhibitedCountries', 'shippingProhibitedSkus', 'shippingDutyRatePercent', 'shippingEtaBusinessHours',
      'upsClientId', 'upsClientSecret', 'upsAccountNumber', 'upsSandbox',
      'fedexClientId', 'fedexClientSecret', 'fedexAccountNumber', 'fedexSandbox',
      'uspsClientId', 'uspsClientSecret',
      'dhlApiUser', 'dhlApiPassword', 'dhlAccountNumber', 'dhlTrackingApiKey', 'dhlSandbox',
      'royalMailClientId', 'royalMailClientSecret',
      'yurticiApiUrl', 'yurticiUsername', 'yurticiPassword',
      'arasApiUrl', 'arasApiKey', 'arasUsername', 'arasPassword',
      'mngApiUrl', 'mngApiKey', 'mngUsername', 'mngPassword',
      'pttApiUrl', 'pttApiKey', 'pttUsername', 'pttPassword',
      'suratApiUrl', 'suratApiKey', 'suratUsername', 'suratPassword',
      'sendeoApiUrl', 'sendeoApiKey', 'sendeoUsername', 'sendeoPassword',
      'hepsijetApiUrl', 'hepsijetApiKey', 'hepsijetUsername', 'hepsijetPassword',
      'dpdApiUrl', 'dpdApiKey', 'dpdUsername', 'dpdPassword',
      'glsApiUrl', 'glsApiKey', 'glsUsername', 'glsPassword',
      'postnlApiUrl', 'postnlApiKey', 'postnlUsername', 'postnlPassword',
      'fulfillmentCarriers',
    ],
  },
  {
    // commerce_wishlist.setting.keys.ts: Wishlists → Settings. The module has no update id: a write needs its read id and
    // tenant_setting.config.update.
    moduleId: 'commerce_wishlist',
    read: ['commerce_wishlist.wishlists.read'],
    update: ['commerce_wishlist.wishlists.read'],
    keys: ['wishlistPriceDropEmail', 'wishlistBackInStockEmail', 'wishlistPriceDropMinPercent', 'wishlistGuestListRetentionDays'],
  },
  {
    // pos.setting.keys.ts: Point of Sale → Settings (both keys are OWNER-only too, tenant_setting.key-policy.ts).
    moduleId: 'pos',
    read: ['pos.registers.read'],
    update: ['pos.registers.manage'],
    keys: ['posManagerPriceOverride', 'posCloseVarianceNoteAboveMinor'],
  },
  {
    // quote.setting.keys.ts: Quotes → Settings. A write needs the discount approver's id, not quote.quotes.update (USER):
    // raising the threshold would let a seller skip discount approval.
    moduleId: 'quote',
    read: ['quote.quotes.read'],
    update: ['quote.quotes.discount_approve'],
    keys: ['quoteDiscountApprovalThreshold', 'quoteBaseCurrency', 'quoteNumberPrefix', 'quoteDefaultValidityDays'],
  },
  {
    // iot_telemetry.setting.keys.ts: IoT → Telemetry → Settings (the accepted timestamp window of incoming telemetry).
    moduleId: 'iot_telemetry',
    read: ['iot_telemetry.settings.read'],
    update: ['iot_telemetry.settings.update'],
    keys: ['iotTelemetryMaxFutureMinutes', 'iotTelemetryMaxAgeDays'],
  },
  {
    // iot_pki.setting.keys.ts: IoT → Certificates → Settings (the device certificate expiry warning, never later than 30 days).
    moduleId: 'iot_pki',
    read: ['iot_pki.certificates.read'],
    update: ['iot_pki.settings.update'],
    keys: ['iotPkiDeviceExpiryWarnDays'],
  },
  {
    // iot_camera.setting.keys.ts: IoT → Cameras → Settings (the retention windows of camera media, clamped to the plan, and whether camera media counts
    // toward the general storage quota; phase 10: the tenant recording switch, the segment length, the event clip roll and whether playback redirects to a
    // signed URL). A write also needs the camera manage permission: shortening a window deletes footage.
    moduleId: 'iot_camera',
    read: ['iot_camera.cameras.read'],
    update: ['iot_camera.cameras.manage'],
    keys: [
      'iotCameraMediaCountsTowardStorageQuota', 'iotCameraContinuousRetentionDays', 'iotCameraEventClipRetentionDays',
      'iotCameraRecordingEnabled', 'iotCameraSegmentSeconds', 'iotCameraClipPreRollSeconds', 'iotCameraClipPostRollSeconds', 'iotCameraPlaybackRedirect',
    ],
  },
  {
    // automation.setting.keys.ts: Automation → Settings (the daily purge's retention, never below today's floors).
    moduleId: 'automation',
    read: ['automation.read'],
    update: ['automation.manage'],
    keys: ['automationDraftRetentionDays', 'automationVersionsKeepLast', 'automationVersionsKeepDays'],
  },
  {
    // wallet.setting.keys.ts: Wallet → Settings (walletMaxTransferAmount is OWNER-only too).
    moduleId: 'wallet',
    read: ['wallet.accounts.read'],
    update: ['wallet.accounts.manage'],
    keys: ['walletDefaultCurrency', 'walletMaxTransferAmount'],
  },
  {
    // payment_subscription.setting.keys.ts: Customer Subscriptions → Settings (dunning budget, subscriber reminders).
    moduleId: 'payment_subscription',
    read: ['payment_subscription.subscriptions.read'],
    update: ['payment_subscription.subscriptions.update'],
    keys: ['dunningMaxAttempts', 'subscriptionReminderLeadDays', 'subscriptionTrialRemindersEnabled', 'subscriptionRenewalRemindersEnabled'],
  },
  {
    // bank.setting.keys.ts: Bank → Settings.
    moduleId: 'bank',
    read: ['bank.accounts.read'],
    update: ['bank.accounts.manage'],
    keys: ['bankMatchDateWindowDays'],
  },
  {
    // fx.setting.keys.ts: Exchange Rates → Settings, a ROOT-only page; the keys are platform-only (key-policy.ts).
    moduleId: 'fx',
    read: ['fx.rates.read'],
    update: ['fx.overrides.create'],
    keys: ['fxCacheTtlHours', 'fxStaleAfterHours', 'fxFallbackProviderEnabled'],
  },
  {
    // tax.setting.keys.ts: Taxes → Settings (payment's taxRate / taxEnabled stay payment's).
    moduleId: 'tax',
    read: ['tax.rates.read'],
    update: ['tax.rates.update'],
    keys: ['taxRoundingMode', 'taxRoundingLevel'],
  },
  {
    // fleet.setting.keys.ts: Fleet → Settings, in the fleet tenant (read from FLEET_TENANT_ID): alert mail and earlier
    // expiry warnings only, never fewer alerts.
    moduleId: 'fleet',
    read: ['fleet.alerts.read'],
    update: ['fleet.alerts.manage'],
    keys: ['fleetAlertPageMedium', 'fleetCertExpiryWarnDays', 'fleetLicenseExpiryWarnDays'],
  },
  {
    // fleet_license.setting.keys.ts: License → Settings, a ROOT-only page; the key is platform-only (key-policy.ts).
    moduleId: 'fleet_license',
    read: ['fleet_license.status.read'],
    update: ['fleet_license.status.manage'],
    keys: ['fleetLicenseRenewBelowDays'],
  },
  {
    // plugin_runtime.setting.keys.ts: Plugins → Settings, a ROOT-only page of lower-only broker caps; platform-only keys.
    moduleId: 'plugin_runtime',
    read: ['plugin_runtime.settings.read'],
    update: ['plugin_runtime.settings.update'],
    keys: ['pluginPresignMaxSeconds', 'pluginUploadMaxMb', 'pluginKvMaxValueKb'],
  },
  {
    // contact.setting.keys.ts: Companies → Settings (the outbound quota is OWNER-only too).
    moduleId: 'contact',
    read: ['contact.companies.read'],
    update: ['contact.companies.update'],
    keys: ['contactDuplicateReviewThreshold', 'contactOutboundHourlyQuota'],
  },
  {
    // crm_lead.setting.keys.ts: Leads → Settings (the AI agent's idle windows).
    moduleId: 'crm_lead',
    read: ['crm_lead.leads.read'],
    update: ['crm_lead.leads.update'],
    keys: ['crmLeadQualifyIdleHours', 'crmLeadFollowupIdleDays'],
  },
  {
    // crm_opportunity.setting.keys.ts: Pipeline → Settings.
    moduleId: 'crm_opportunity',
    read: ['crm_opportunity.opportunities.read'],
    update: ['crm_opportunity.opportunities.update'],
    keys: ['crmOpportunityStaleDays', 'crmOpportunityAtRiskTag'],
  },
  {
    // marketing.setting.keys.ts: Campaigns → Settings (each key only narrows sending; consent, suppression and unsubscribe are untouched).
    moduleId: 'marketing',
    read: ['marketing.campaigns.read'],
    update: ['marketing.campaigns.update'],
    keys: ['marketingEngagementTracking', 'marketingFormTriggerWindowHours', 'marketingMaxCampaignRecipients'],
  },
  {
    // utm.setting.keys.ts: UTM Campaigns → Settings.
    moduleId: 'utm',
    read: ['utm.campaigns.read'],
    update: ['utm.configure'],
    keys: ['utmAutoCreateDictionary', 'utmTouchDedupeMinutes', 'utmLandingDropParams'],
  },
  {
    // seo.setting.keys.ts: SEO → Settings (robots.txt rules, Web Vitals sampling).
    moduleId: 'seo',
    read: ['seo.metadata.read'],
    update: ['seo.metadata.update'],
    keys: ['metaRobots', 'sitemapEnabled', 'robotsDisallow', 'aiCrawlerDisallowedBots', 'rumSampleRate'],
  },
  {
    // events.setting.keys.ts: Events → Settings.
    moduleId: 'events',
    read: ['events.events.read'],
    update: ['events.events.manage'],
    keys: ['eventsPaymentWindowMinutes', 'eventsRegistrationCloseMinutes'],
  },
  {
    // consent_registry_iys.setting.keys.ts: Settings → İYS Consent Registry (the account and its endpoint are OWNER-only too: a switch to the sandbox would void the legal check).
    moduleId: 'consent_registry_iys',
    read: ['consent_registry_iys.settings.read'],
    update: ['consent_registry_iys.settings.update'],
    keys: [
      'iysCode', 'iysBrandCode', 'iysUsername', 'iysPassword', 'iysBaseUrl', 'iysConsentSource',
    ],
  },
  {
    // mail_inbound.setting.keys.ts: Settings → Inbound Mail.
    moduleId: 'mail_inbound',
    read: ['mail_inbound.settings.read'],
    update: ['mail_inbound.settings.update'],
    keys: [
      'mailInboundRawRetentionDays', 'mailInboundStoreRejectedRaw', 'mailInboundQuarantineOnDmarcNone',
      'mailInboundSpamRejectScore', 'mailInboundRatePerSenderHourly',
      'mailInboundWebhookSecret', 'mailInboundWebhookSecretPrevious',
    ],
  },
  {
    // notification_push.setting.keys.ts: Settings → Push Notifications, with its on/off switch (the VAPID pair and its
    // contact e-mail stay notification_mail's, on Settings → Notifications).
    moduleId: 'notification_push',
    read: ['notification_push.settings.read'],
    update: ['notification_push.settings.update'],
    keys: [
      'pushEnabled', 'pushProvider', 'pushMaxSubscriptionsPerUser', 'pushQuietHoursStart', 'pushQuietHoursEnd',
    ],
  },
  {
    // notification_inapp.setting.keys.ts: Settings → In-app Notifications.
    moduleId: 'notification_inapp',
    read: ['notification_inapp.settings.read'],
    update: ['notification_inapp.settings.update'],
    keys: [
      'inAppRetentionDays', 'inAppQuietHours',
    ],
  },
  {
    // hr_document.setting.keys.ts: Document Compliance → Settings (which nationalities the requirements treat as local).
    moduleId: 'hr_document',
    read: ['hr_document.compliance.read'],
    update: ['hr_document.settings.update'],
    keys: ['hrDocumentLocalNationalities'],
  },
  {
    // hr_recruitment.setting.keys.ts: Hiring → Settings (requisition numbering, the candidate keep-until default).
    moduleId: 'hr_recruitment',
    read: ['hr_recruitment.applications.read'],
    update: ['hr_recruitment.requisitions.manage', 'hr_recruitment.candidates.manage'],
    keys: ['hrRecruitmentRequisitionPrefix', 'hrRecruitmentCandidateRetentionDays'],
  },
  {
    // hr_schedule.setting.keys.ts: Work Schedules → Settings.
    moduleId: 'hr_schedule',
    read: ['hr_schedule.assignments.read'],
    update: ['hr_schedule.settings.update'],
    keys: ['hrScheduleTeamWindowDays', 'hrScheduleMyWindowDays'],
  },
  {
    // hr_shift.setting.keys.ts: Shift rosters → Settings.
    moduleId: 'hr_shift',
    read: ['hr_shift.rosters.read'],
    update: ['hr_shift.rosters.update'],
    keys: ['hrShiftMinRestHours', 'hrShiftSwapMinNoticeDays', 'hrShiftMyShiftsHorizonDays', 'hrShiftNotifyOnPublish'],
  },
  {
    // hr_timesheet.setting.keys.ts (MS-19): Timesheets → Settings (the timesheet period). A write needs the approver's
    // id: the period decides how every member's timesheet is cut.
    moduleId: 'hr_timesheet',
    read: ['hr_timesheet.timesheets.read'],
    update: ['hr_timesheet.timesheets.approve'],
    keys: ['hrTimesheetPeriod'],
  },
  {
    // hr_contract.setting.keys.ts: HR Contracts → Settings; the salary id is OWNER floor, so a write is the owner's.
    moduleId: 'hr_contract',
    read: ['hr_contract.contracts.read'],
    update: ['hr_contract.salary.manage'],
    keys: ['hrContractRevisionHistoryRows', 'hrContractDefaultRevisionReason'],
  },
  {
    // asset.setting.keys.ts: Assets → Settings.
    moduleId: 'asset',
    read: ['asset.assets.read'],
    update: ['asset.assets.update'],
    keys: ['assetMaintenanceLookaheadDays', 'assetTagNumberWidth', 'assetUsageDueAtFraction'],
  },
  {
    // contract.setting.keys.ts: Contracts → Settings (no key touches a signed contract or a document).
    moduleId: 'contract',
    read: ['contract.contracts.read'],
    update: ['contract.contracts.update'],
    keys: ['contractNoticeDueWindowDays', 'contractDefaultRenewalNoticeDays'],
  },
  {
    // field_service.setting.keys.ts: Field Service → Settings.
    moduleId: 'field_service',
    read: ['field_service.orders.read'],
    update: ['field_service.orders.manage'],
    keys: ['fieldServiceOrderPrefix'],
  },
  {
    // manufacturing.setting.keys.ts: Manufacturing → Settings.
    moduleId: 'manufacturing',
    read: ['manufacturing.work_centers.read'],
    update: ['manufacturing.work_centers.manage'],
    keys: ['manufacturingMrpIncludeSalesOrders', 'manufacturingDefaultIdleThresholdMinutes'],
  },
  {
    // project.setting.keys.ts: Projects → Settings (the cap on one time entry, never above a day).
    moduleId: 'project',
    read: ['project.projects.read'],
    update: ['project.projects.update'],
    keys: ['projectMaxMinutesPerTimeEntry'],
  },
  {
    // warehouse.setting.keys.ts: Warehouse → Settings.
    moduleId: 'warehouse',
    read: ['warehouse.tasks.read'],
    update: ['warehouse.locations.manage'],
    keys: ['warehouseDefaultTaskPriority', 'warehouseDefaultBreachGraceMinutes'],
  },
  {
    // tasks.setting.keys.ts: Tasks → Settings.
    moduleId: 'tasks',
    read: ['tasks.tasks.read'],
    update: ['tasks.tasks.update'],
    keys: ['tasksDefaultPriority', 'tasksOverdueEscalateToOwner', 'tasksDefaultReminderLeadMinutes'],
  },
  {
    // activity.setting.keys.ts: Activities → Settings (the deletion window is OWNER-only too).
    moduleId: 'activity',
    read: ['activity.activities.read'],
    update: ['activity.activities.update'],
    keys: ['activityTimelinePageSize', 'activityAllowDeleteAfterHours', 'activityDefaultChannelForCall'],
  },
  {
    // ai_chat.setting.keys.ts: AI Chat → Settings, and the chat profiles its own route writes.
    moduleId: 'ai_chat',
    read: ['ai_chat.profiles.read'],
    update: ['ai_chat.profiles.update'],
    keys: ['aiChat.profiles', 'aiChatMaxHistoryMessages'],
  },
  {
    // marketplace.setting.keys.ts: Marketplace → Plugin settings, and the install policy and upstream feed its validating routes write; a write needs the OWNER-floor community id.
    moduleId: 'marketplace',
    read: ['marketplace.community.read'],
    update: ['marketplace.community.manage'],
    keys: [
      'marketplaceAutoUpdate', 'marketplaceUninstallRetentionDays', 'marketplaceCommunityReviewModeration',
      'marketplaceInstallPolicy', 'marketplaceUpstreamFeedUrl', 'marketplaceAllowBlockScripts',
    ],
  },
  {
    // marketplace_developer.setting.keys.ts: Marketplace → Revenue → Settings, a ROOT-only page; platform-only and OWNER-only money controls.
    moduleId: 'marketplace_developer',
    read: ['marketplace_developer.settings.read'],
    update: ['marketplace_developer.settings.update'],
    keys: ['marketplaceRevenueSharePct', 'marketplacePayoutHoldDays'],
  },
  {
    // tenant.setting.keys.ts: Maintenance → Settings (tenant.general.setting.keys.ts, the tenant's general keys, stays unowned).
    moduleId: 'tenant',
    read: ['tenant.maintenance.manage'],
    update: ['tenant.maintenance.manage'],
    keys: ['maintenanceDefaultAllowRoles', 'maintenanceCacheTtlSeconds', 'maintenancePreNotifyHours'],
  },
  {
    // tenant_invitation.setting.keys.ts: Invitations → Settings (the lifetime can only be shortened; the roles are OWNER-only too).
    moduleId: 'tenant_invitation',
    read: ['tenant_invitation.invitations.read'],
    update: ['tenant_invitation.invitations.invite'],
    keys: ['invitationTtlDays', 'invitationAllowedRoles'],
  },
  {
    // tenant_usage.setting.keys.ts: Usage → Settings.
    moduleId: 'tenant_usage',
    read: ['tenant_usage.metrics.read'],
    update: ['tenant_usage.settings.update'],
    keys: ['usageAlertThresholds'],
  },
  {
    // feature_flags.setting.keys.ts: Experiments → Settings (each value can only make the peeking guard stricter).
    moduleId: 'feature_flags',
    read: ['feature_flags.experiments.read'],
    update: ['feature_flags.experiments.manage'],
    keys: ['experimentMinDetectableEffect', 'experimentSignificanceLevel', 'experimentMinSamplePerArm'],
  },
  {
    // module_lifecycle.setting.keys.ts: Platform → Modules → Settings, a ROOT-only page, and the platform default modules and pending provisioning its own service writes.
    moduleId: 'module_lifecycle',
    read: ['module_lifecycle.platform.manage'],
    update: ['module_lifecycle.platform.manage'],
    keys: ['platformDefaultModules', 'moduleLifecycleProvisioningPending', 'moduleRestoreWindowDays'],
  },
  {
    // telemetry.setting.keys.ts: Telemetry → Settings, a ROOT-only page (the minute rollup's tuning; platform-only).
    moduleId: 'telemetry',
    read: ['telemetry.admin.read'],
    update: ['telemetry.admin.manage'],
    keys: ['telemetryRollupDbSharePercent', 'telemetryRollupMaxSteps', 'telemetryRollupFullSweepEvery'],
  },
  {
    // tenant_export.setting.keys.ts: Settings → Data export; the export id is OWNER floor, so a write is the owner's.
    moduleId: 'tenant_export',
    read: ['tenant_export.data.export'],
    update: ['tenant_export.data.export'],
    keys: ['exportAuditLogCap', 'exportMinIntervalMinutes'],
  },
  {
    // limiter.setting.keys.ts: Platform → Rate limits → Settings, a ROOT-only page; every key only tightens a built-in limit; platform-only.
    moduleId: 'limiter',
    read: ['limiter.settings.read'],
    update: ['limiter.settings.update'],
    keys: [
      'limiterAuthPerMinute',
      'limiterLoginPerMinute',
      'limiterStrikeThreshold',
      'limiterBanBaseMinutes',
      'limiterApiPerMinute',
    ],
  },
  {
    // redis_idempotency.setting.keys.ts: Platform → Idempotency → Settings, a ROOT-only page; both keys only lengthen a window; platform-only.
    moduleId: 'redis_idempotency',
    read: ['redis_idempotency.settings.read'],
    update: ['redis_idempotency.settings.update'],
    keys: ['idempotencyReplayHours', 'idempotencyPendingMinutes'],
  },
  {
    // user_session.setting.keys.ts: Settings → Geo-IP, a ROOT-only page (one provider for the installation, read from ROOT, platform-only), and the login anomaly keys login-risk reads.
    moduleId: 'user_session',
    read: ['user_session.settings.read'],
    update: ['user_session.settings.update'],
    keys: [
      'geoIpProvider', 'geoIpApiKey', 'loginAnomalyResponse', 'loginAnomalyVelocityKmh',
    ],
  },
  {
    // tenant_session.setting.keys.ts (MS-39): Settings → Sign-in Policy (two-step verification required, the IP allow /
    // deny lists) and the session keys tenant_session.policy.ts reads (sessionTimeout, maxConcurrentSessions). Four are
    // OWNER-only too (tenant_setting.key-policy.ts).
    moduleId: 'tenant_session',
    read: ['tenant_session.settings.read'],
    update: ['tenant_session.settings.update'],
    keys: ['twoFactorRequired', 'sessionTimeout', 'maxConcurrentSessions', 'ipWhitelist', 'ipBlacklist'],
  },
  {
    // user_security.setting.keys.ts (MS-37): Settings → Trusted Devices, a ROOT-only page (the device lifetime is the
    // installation's, platform-only). The Security tab's keys that sat in the same file are tenant_setting's now.
    moduleId: 'user_security',
    read: ['user_security.settings.read'],
    update: ['user_security.settings.update'],
    keys: ['trustedDeviceTtlDays'],
  },
  {
    // user_preferences.setting.keys.ts: Settings → Member preferences (the members' default theme and formats).
    moduleId: 'user_preferences',
    read: ['user_preferences.settings.read'],
    update: ['user_preferences.settings.update'],
    keys: [
      'defaultTheme', 'defaultNumberFormat', 'defaultMeasurementSystem', 'defaultDateFormat', 'defaultTimeFormat',
      'defaultFirstDayOfWeek',
    ],
  },
  {
    // user_profile.setting.keys.ts: Settings → Profiles (reserved names, custom fields, image moderation).
    moduleId: 'user_profile',
    read: ['user_profile.settings.read'],
    update: ['user_profile.settings.update'],
    keys: [
      'reservedDisplayNames', 'profileCustomFields', 'avatarModerationProvider', 'avatarModerationApiUser',
      'avatarModerationApiKey', 'avatarModerationThreshold', 'avatarModerationUrl',
    ],
  },
  {
    // terms_consent.setting.keys.ts (MS-26): the cookie banner, the checkout's required agreements and the seller's legal
    // identity printed into the agreements. No settings page: the banner is written by its own consent-config route
    // (consent_config.update). On the generic API a write needs both of the module's ADMIN update ids, the banner's and the
    // agreements' (checkoutRequiredAgreements is OWNER-only too, tenant_setting.key-policy.ts).
    moduleId: 'terms_consent',
    read: ['terms_consent.agreements.read'],
    update: ['terms_consent.consent_config.update', 'terms_consent.agreements.update'],
    keys: [
      'consentBannerEnabled', 'consentPolicyVersion', 'consentBannerTitle', 'consentBannerMessage', 'consentPurposes',
      'checkoutRequiredAgreements', 'legalSellerName', 'legalSellerAddress', 'legalSellerTaxOffice', 'legalSellerTaxId',
      'legalSellerMersis', 'legalSellerEmail', 'legalSellerPhone',
    ],
  },
  // SG-04 (2026-10-27): the module settings pages that were guarded by the generic setting permission alone.
  {
    // auth_sso.setting.keys.ts: SSO → Settings (the BYO `ssoClient*:<provider>` families are run-time keys, not listed).
    moduleId: 'auth_sso',
    read: ['auth_sso.settings.read'],
    update: ['auth_sso.settings.update'],
    keys: ['ssoTenantReturnPath', 'ssoClientSecretExpiryDays', 'ssoProfileSync'],
  },
  {
    // impersonation.setting.keys.ts: Impersonation → Settings.
    moduleId: 'auth_impersonation',
    read: ['auth_impersonation.settings.read'],
    update: ['auth_impersonation.settings.update'],
    keys: [
      'impersonationSessionTtlMinutes', 'impersonationRequireStepUp', 'impersonationMaxConcurrentPerImpersonator',
      'impersonationDisabled', 'impersonationAlertStartsPerHour', 'impersonationExemptRoles',
    ],
  },
  {
    // clay.setting.keys.ts: Settings → Enrichment → Clay (the API key spends credits).
    moduleId: 'enrichment_clay',
    read: ['enrichment_clay.settings.read'],
    update: ['enrichment_clay.settings.update'],
    keys: ['clayApiKey', 'clayApiBaseUrl', 'clayCompanyRoutineId', 'clayPersonRoutineId'],
  },
  {
    // dashboard.setting.keys.ts: Dashboards → Settings (the sites a card may frame).
    moduleId: 'dashboard',
    read: ['dashboard.settings.read'],
    update: ['dashboard.settings.update'],
    keys: ['dashboardEmbedHosts'],
  },
  {
    // auth.setting.keys.ts (MS-44): the password, lockout, session, MFA, registration, SSO and provider-credential policy,
    // edited on Authentication Settings and Settings → Authentication & SSO. The tenant's general keys moved to
    // auth.general.setting.keys.ts and stay unowned. auth 001 / 002 gave the two ids to every role holding the generic ones.
    moduleId: 'auth',
    read: ['auth.settings.read'],
    update: ['auth.settings.update'],
    keys: [
      'jwtAccessTokenSecret', 'jwtAccessTokenExpiresIn', 'jwtRefreshTokenSecret', 'jwtRefreshTokenExpiresIn',
      'oauthGoogle', 'oauthGitHub', 'oauthMicrosoft', 'oauthLinkedIn', 'oauthApple', 'oauthTwitter', 'oauthMeta',
      'oauthAutodesk', 'googleClientId', 'googleClientSecret', 'githubClientId', 'githubClientSecret', 'appleClientId',
      'appleTeamId', 'appleKeyId', 'applePrivateKey', 'metaClientId', 'metaClientSecret', 'autodeskClientId',
      'autodeskClientSecret', 'gitlabToken', 'gitlabUser', 'passwordMinLength', 'passwordRequireUppercase',
      'passwordRequireLowercase', 'passwordRequireDigit', 'passwordRequireSpecial', 'passwordHistoryCount',
      'passwordMaxAgeDays', 'lockoutMaxAttempts', 'lockoutDurationMinutes', 'sessionAbsoluteMaxHours',
      'sessionIdleTimeoutMinutes', 'sessionRememberMeMaxHours', 'dormantAccountDays', 'dormantAccountAutoDisable',
      'adminPanelIpAllowlist', 'adminRequireMfa', 'externalRequireMfa', 'totpIssuer', 'disableSocialLogin',
      'captchaTriggerAttempts', 'singleSessionOnly', 'allowRegistration', 'allowSelfRegistration',
      'selfServiceTenantLimit', 'emailVerificationRequired', 'ssoAllowedProviders', 'otpLength', 'otpExpirySeconds',
      'otpRateLimitSeconds', 'otpMaxAttempts', 'resetTokenExpirySeconds', 'resetTokenLength', 'emailVerifyTtlSeconds',
      'emailVerifyRateLimitSeconds', 'bcryptCost', 'passwordMinAgeDays', 'dormantDeleteAfterDays', 'mfaAllowedMethods',
      'passwordBreachCheck', 'magicLinkEnabled', 'magicLinkTtlSeconds', 'magicLinkRateLimitSeconds', 'captchaProvider',
    ],
  },
  {
    // integrations_hub.setting.keys.ts (MS-20): each connector's OAuth client id and secret, one pair per connector key,
    // written from the connector form. Families, not keys: the connector key is a run-time suffix.
    moduleId: 'integrations_hub',
    read: ['integrations_hub.connectors.read'],
    update: ['integrations_hub.connectors.write'],
    keys: [],
    prefixes: ['integrationsClientId:', 'integrationsClientSecret:'],
  },
  {
    // invoice.setting.keys.ts: Invoices → Settings (numbering and new-invoice defaults) and the keys no page shows yet (the
    // issuer's company* keys organization projects, the e-invoice integrators, the signing pair, the PDF template). A
    // write needs the issuer's id (OWNER floor): numbering, VAT fallback and signing material are legal evidence.
    moduleId: 'invoice',
    read: ['invoice.invoices.read'],
    update: ['invoice.invoices.issue'],
    keys: [
      'companyLegalName', 'companyTaxId', 'companyTaxOffice', 'companyAddressLine1', 'companyAddressLine2',
      'companyCity', 'companyPostalCode', 'companyCountryCode', 'companyPhone', 'companyEmail', 'companyWebsite',
      'companyLogoUrl', 'companyIban', 'companyProvince', 'invoiceNumberPrefix', 'invoiceNumberPadding',
      'invoiceNumberResetPolicy', 'invoiceFiscalYearStartMonth', 'invoiceCreditNotePrefix', 'invoiceDefaultDueDays',
      'invoiceDefaultCurrency', 'invoiceDefaultVatRate', 'earsivIntegrator', 'earsivIntegratorBaseUrl',
      'earsivIntegratorUsername', 'earsivIntegratorPassword', 'earsivIntegratorSandbox', 'earsivAutoSubmit',
      'earsivDocumentTypeOverride', 'peppolEndpointId', 'peppolDocumentTypeId', 'peppolAccessPointUrl',
      'peppolAccessPointToken', 'peppolAutoSubmit', 'euVatNumber', 'invoiceSigningKeyPem', 'invoiceSigningCertPem',
      'fatturapaGatewayUrl', 'fatturapaGatewayToken', 'fatturapaTransmitterCountry', 'fatturapaTransmitterCode',
      'fatturapaCodiceDestinatario', 'fatturapaPecDestinatario', 'fatturapaFormat', 'fatturapaRegimeFiscale',
      'chorusProGatewayUrl', 'chorusProToken', 'chorusProSiret', 'zugferdProfile', 'zugferdGatewayUrl',
      'zugferdGatewayToken', 'cfdiPacUrl', 'cfdiPacToken', 'cfdiRfcEmisor', 'cfdiRegimenFiscal', 'cfdiSerie',
      'cfdiUsoCfdi', 'cfdiMetodoPago', 'cfdiFormaPago', 'cfdiReceptorRegimen', 'gstIrpUrl', 'gstIrpToken', 'gstGstin',
      'gstStateCode', 'invoicePdfPrimaryColor', 'invoicePdfAccentColor', 'invoicePdfTextColor', 'invoicePdfMutedColor',
      'invoicePdfFontFamily', 'invoicePdfPaperSize', 'invoicePdfLanguage', 'invoicePdfShowLogo', 'invoicePdfShowIban',
      'invoicePdfShowTaxOffice', 'invoicePdfFooterText', 'invoicePdfFooterTermsUrl', 'invoicePdfHeaderTagline',
      'invoicePdfWatermark',
    ],
  },
  {
    // mcp_server.setting.keys.ts MCP_SERVER_KEYS: Settings → MCP (docs/phases/57-mcp-server): the workspace's MCP switch and the tools it
    // switched off. They decide who may reach the workspace's data through an AI app, so only mcp_server.settings.manage (ADMIN) reads or
    // writes them.
    moduleId: 'mcp_server',
    read: ['mcp_server.settings.manage'],
    update: ['mcp_server.settings.manage'],
    keys: ['mcpEnabled', 'mcpDisabledTools', 'mcpAllowedClientHosts'],
  },
  {
    // ai_firewall.setting.keys.ts: the AI firewall's settings (phase 55 01 §1.1, §1.7): how long its security events are kept, the kill
    // switches, the default mode, the per-action modes (`aiFirewallMode:<actionId>`) and the opt-in for a hard block of sign-ups (02.6). Shortening the retention deletes evidence and the
    // switches decide what the firewall may do on its own, so a write needs the firewall's settings id AND its actions id (modes, kill
    // switch), never tenant_setting.config.update alone.
    moduleId: 'ai_firewall',
    read: ['ai_firewall.settings.manage'],
    update: ['ai_firewall.settings.manage', 'ai_firewall.actions.manage'],
    keys: ['aiFirewallRetentionDays', 'aiFirewallKillSwitch', 'aiFirewallPlatformKillSwitch', 'aiFirewallDefaultMode', 'aiFirewallSignupHardBlock'],
    prefixes: ['aiFirewallMode:'],
  },
];

const OWNER_OF_KEY: ReadonlyMap<string, SettingKeyOwner> = new Map(
  SETTING_KEY_OWNERS.flatMap((owner) => owner.keys.map((key) => [key, owner] as const)),
);

const PREFIX_OWNERS: ReadonlyArray<readonly [string, SettingKeyOwner]> = SETTING_KEY_OWNERS.flatMap(
  (owner) => (owner.prefixes ?? []).map((prefix) => [prefix, owner] as const),
);

/** The module whose settings `key` is, or undefined for a key of the tenant's own settings. */
export const settingKeyOwner = (key: string): SettingKeyOwner | undefined =>
  OWNER_OF_KEY.get(key) ?? PREFIX_OWNERS.find(([prefix]) => key.length > prefix.length && key.startsWith(prefix))?.[1];

/** The distinct owners of `keys`. */
export function ownersOfKeys(keys: Iterable<string>): SettingKeyOwner[] {
  const out = new Set<SettingKeyOwner>();
  for (const key of keys) {
    const owner = settingKeyOwner(key);
    if (owner) out.add(owner);
  }
  return [...out];
}
