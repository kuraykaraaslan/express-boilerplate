import type { MailCoverageProvider } from '@kuraykaraaslan-labs/announcement/server/announcement.types'
import StatusSubscriberService from './status.subscriber.service'

/**
 * Point `announcement:mail_coverage` (docs/phases/47-announcements B): the status page already mails its verified
 * subscribers when a tenant's maintenance window starts (status.maintenance.bridge), so the window's start notice
 * leaves those addresses out of its own mail and a subscriber who is also a user gets one mail, not two. Asked for
 * nothing else: the bridge mails nobody about a system window or a cancellation.
 */
const provider: MailCoverageProvider = {
  async coveredAddresses({ tenantId, emails }) {
    return StatusSubscriberService.mailedAddresses(tenantId, emails)
  },
}

export default provider
