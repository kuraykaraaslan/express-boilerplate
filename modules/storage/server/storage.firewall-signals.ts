/**
 * storage's signal kinds for the AI firewall (`ai_firewall:signal`, docs/phases/55-ai-firewall/01 §1.6): the virus scanner found malware in
 * an upload (phase 55 00.3; refused in sync mode, quarantined or deleted in async mode), aggregated per tenant, uploader and minute; the
 * direct-upload CORS rule applied to the tenant's bucket by an administrator; a machine download link served (always a SYSTEM row with
 * the client's address). Only the contract from common is imported (ADR-0008 §2).
 */
import {
  REFUSAL_ROW_METADATA,
  auditRowSignal,
  signalAttr as a,
  type FirewallSignalContribution,
} from '@kuraykaraaslan-labs/common/server/common.firewall-contracts';

const STORAGE_CORS = {
  endpoint: a.untrusted('network', 'the storage endpoint\'s host, or aws'), rulesBefore: a.number('none'), rulesAfter: a.number('none'),
};
const STORAGE_LINK = {
  purpose: a.untrusted('none', 'what the link was made for, e.g. iot_ota.firmware'), key: a.untrusted('content', 'the stored object\'s key, which can carry an uploaded file name'),
  audience: a.untrusted('device', 'the client the link is bound to, e.g. a device id'), range: a.untrusted('none'), bytes: a.number('none'),
  status: a.number('none', 'the HTTP status served'), mode: a.untrusted('none', 'how the file was served'), completed: a.flag(),
};

const SIGNALS: FirewallSignalContribution[] = [
  auditRowSignal({
    kind: 'file.infected', severity: 'critical', defaultWeight: 0.7, outcomes: ['info'], actorKinds: ['user', 'apiKey', 'anon'],
    metadata: {
      ...REFUSAL_ROW_METADATA,
      mode: a.untrusted('none', 'sync or async scanning'), provider: a.untrusted('none', 'the scanner'), threat: a.untrusted('none', 'the scanner\'s name for the malware'),
      filename: a.untrusted('content', 'the uploaded file\'s name, as the uploader gave it'),
    },
  }),
  // the bucket's CORS rules decide which origins a browser may upload from and read with
  auditRowSignal({ kind: 'storage.bucket_cors.applied', severity: 'medium', defaultWeight: 0.2, outcomes: ['info'], actorKinds: ['user'], metadata: STORAGE_CORS }),
  // a shared link opened: a read of a stored file by whoever holds the link
  auditRowSignal({ kind: 'storage.link.fetched', severity: 'low', defaultWeight: 0.05, outcomes: ['info'], actorKinds: ['anon'], metadata: STORAGE_LINK }),
];

export default SIGNALS;
