import 'reflect-metadata';
import Logger from '@kuraykaraaslan-labs/logger';
import { SETTING_CHANGE_ENTITY_TYPE } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.write.maker-checker';
import { applySettingChangeDecision, assertSettingChangeApprovable } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.change-decision';
import ApprovalQueueService from './approval.service';

/**
 * Register the decision handler of parked setting changes (maker-checker, `tenant_setting_change` items, submitted by
 * approval's `tenant_setting:change_review` contribution). A `common:boot_task` of the `approval` phase, so it runs in
 * every process that can record a decision and again, lazily, in the copy that decides (approval.handlers.ts).
 *
 * The handler hands the decision to tenant_setting, which applies or discards the change. It used to be tenant_setting's
 * boot task, registered with a dynamic import of approval; approval requires tenant_setting, so the call belongs here.
 * Idempotent: the queue keeps one handler per entityType.
 *
 * It also registers the APPROVE guard: tenant_setting checks the change against the approver's request before the
 * decision is recorded (a parked IP list change must not refuse its approver's own address), so a refusal leaves the
 * item pending and nothing is written.
 */
export function registerSettingChangeHandler(): void {
  ApprovalQueueService.registerHandler(SETTING_CHANGE_ENTITY_TYPE, ({ tenantId, item }) =>
    // tenant_setting.08 (fixed 2026-10-20): the queue's own submitter goes with the decision, so the write is attributed to the maker
    // the queue recorded (and the self-decision rule keeps the checker from being the maker), never to a metadata.actorId.
    applySettingChangeDecision(tenantId, { status: item.status, metadata: item.metadata, submittedByUserId: item.submittedByUserId ?? null }));
  ApprovalQueueService.registerDecisionGuard(SETTING_CHANGE_ENTITY_TYPE, ({ tenantId, item, decider }) =>
    assertSettingChangeApprovable(
      tenantId,
      item.metadata,
      decider ? { request: decider.request, exempt: decider.ipListsExempt === true } : undefined,
    ));
  Logger.info('[approval] decision handler registered for tenant_setting_change');
}
