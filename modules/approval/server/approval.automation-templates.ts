import type { FlowTemplate } from '@kuraykaraaslan-labs/automation_integrations';

/**
 * `automation:template` contribution (11 §11.5, G-159): a request and its decision in one flow, offered (not seeded) on the
 * generic host.
 *
 * The request half takes a webhook and opens an approval request of kind `webhook` (`approval.request`, entity type
 * `automation.webhook`). The decision half is a second entry: the queue fires `approval.approved | rejected` as a domain
 * event, and `trigger.event` (kind `approval.*`) takes it, filtered on the entity type so other modules' approvals do not
 * start it, and on the terminal statuses so an escalation or a withdrawal does not either. It tells the workspace admins.
 * A flow that must react to ONE request filters on `msg.payload.approvalItemId` instead (the request node puts it in
 * `msg.metadata.approval`). The same run does not wait for the decision: the engine has no wait-for-signal continuation.
 */
export const REQUEST_KIND = 'webhook';

const template: FlowTemplate = {
  key: 'approval-request-and-decision',
  host: 'generic',
  title: 'Ask for approval from a webhook and act on the decision',
  description: 'A webhook with { reason, userId } opens an approval request; when a reviewer approves or rejects it, the workspace admins are told. Needs the approval module.',
  flow: {
    id: 'approval-request-and-decision',
    version: 1,
    nodes: [
      { id: 'hook', type: 'trigger.webhook', name: 'Request received', params: { auth: 'token' } },
      {
        id: 'request', type: 'approval.request', name: 'Ask for approval',
        params: { kind: REQUEST_KIND, reason: '{{ msg.payload.reason }}', submitter: '{{ msg.payload.userId }}', priority: 0 },
      },
      {
        id: 'decided', type: 'trigger.event', name: 'Request decided',
        params: {
          source: 'domain',
          kind: 'approval.*',
          filter: `msg.payload.entityType == "automation.${REQUEST_KIND}" && (msg.payload.status == "APPROVED" || msg.payload.status == "REJECTED")`,
        },
      },
      {
        id: 'tell', type: 'action.notify', name: 'Tell the admins',
        params: {
          recipients: [{ kind: 'role', value: 'ADMIN' }],
          title: 'Approval request {{ msg.payload.status }}',
          text: 'The approval request {{ msg.payload.approvalItemId }} was {{ msg.payload.status }}.',
        },
      },
    ],
    edges: [
      { from: 'hook', from_port: 'out', to: 'request' },
      { from: 'decided', from_port: 'out', to: 'tell' },
    ],
  },
};

export default template;
