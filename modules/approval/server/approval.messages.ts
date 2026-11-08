export const APPROVAL_MESSAGES = {
  APPROVAL_NOT_FOUND: 'Approval item not found',
  INVALID_TRANSITION: 'Invalid approval status transition',
  ALREADY_DECIDED: 'Approval item has already reached a terminal decision',
  WITHDRAW_FAILED: 'Failed to withdraw the approval item',
  CLAIM_FAILED: 'Approval item can only be claimed while pending',

  SUBMIT_FAILED: 'Failed to submit approval item',
  DECIDE_FAILED: 'Failed to record approval decision',

  CHAIN_EMPTY: 'An approval chain needs at least one step',
  STEP_NOT_FOUND: 'Approval step not found',
  STEP_NOT_PENDING: 'This approval step is not waiting for a decision',
  STEP_NOT_YOURS: 'This approval step is assigned to someone else',
  STEP_OWN_REQUEST: 'You cannot approve your own request',
  SELF_DECISION: 'You cannot decide an approval item you submitted',
} as const;
