/** The four api-key scopes of the operational actions (work order 2 item 7). Pure: no imports, so the schema generators can read it without the environment. */
export const OPS_SCOPES = {
  ack: 'observability_ops:ack',
  incident: 'observability_ops:incident',
  silence: 'observability_ops:silence',
  note: 'observability_ops:note',
} as const;
export type OpsAction = keyof typeof OPS_SCOPES;

