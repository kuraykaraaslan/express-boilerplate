import type { ChoicesContribution } from '@kuraykaraaslan-labs/automation_integrations';
import { systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { listChannelDescriptors } from './notification.channels';

/**
 * `automation:choices` contribution: `notification.channels`, the channels that are live (the four core ones plus every
 * `notification:channel` contribution), for the `channels` field of `action.notify`. The ids are stable slugs, so a stored
 * value needs no remapping on import (`byName` is not needed) and `resolve` only gives them a label. A list is about the
 * deployment, not tenant data, so it takes no tenant filter: a channel whose module is off for the tenant still labels a
 * stored value, and the dispatcher skips it at send time.
 */
const labelled = async (): Promise<Array<{ value: string; label: string }>> =>
  [...(await listChannelDescriptors(systemCtx('automation choices: the deployment\'s notification channels'))).values()]
    .map((d) => ({ value: d.channel, label: d.label }));

const contribution: ChoicesContribution = {
  name: 'notification.channels',
  async list(_tenantId, query) {
    const q = (query.q ?? '').trim().toLowerCase();
    const items = (await labelled()).filter((c) => !q || c.value.includes(q) || c.label.toLowerCase().includes(q));
    return { items: items.slice(0, query.limit ?? 50) };
  },
  async resolve(_tenantId, ids) {
    const known = new Map((await labelled()).map((c) => [c.value, c.label]));
    return Object.fromEntries(ids.filter((id) => known.has(id)).map((id) => [id, known.get(id)!]));
  },
};

export default contribution;
