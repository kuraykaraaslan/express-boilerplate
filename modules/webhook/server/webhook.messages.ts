const WebhookMessages = {
  NOT_FOUND: 'Webhook not found.',
  DELIVERY_NOT_FOUND: 'Webhook delivery not found.',
  URL_REQUIRED: 'Webhook URL is required.',
  URL_INVALID: 'Webhook URL must be a valid HTTPS URL.',
  EVENTS_REQUIRED: 'At least one event must be selected.',
  EVENTS_UNDECLARED: 'One or more events are not available here: no installed module declares them for this workspace.',
  NAME_REQUIRED: 'Webhook name is required.',
  CREATE_SUCCESS: 'Webhook created successfully.',
  UPDATE_SUCCESS: 'Webhook updated successfully.',
  DELETE_SUCCESS: 'Webhook deleted successfully.',
  TEST_SENT: 'Test event dispatched.',
  FORBIDDEN: 'You do not have permission to manage webhooks.',
  REDELIVER_QUEUED: 'Webhook redelivery queued.',
  TEST_DELIVERY_MESSAGE: 'This is a test delivery from the webhook system.',
  ENDPOINT_DISABLED: 'Webhook endpoint is disabled; enable it first.',
  NOT_IN_PLAN: 'Webhooks are not included in your plan.',
  DELIVERY_NOT_REDELIVERABLE: 'Only a failed or dead-lettered delivery can be redelivered.',
  TEST_DELIVERY_NOT_REDELIVERABLE: 'A test delivery is not redelivered; send a new test instead.',
  EVENT_FILTERED_OUT: 'This endpoint\'s event filter would not deliver this payload; change the payload or the filter.',
} as const;

export default WebhookMessages;
