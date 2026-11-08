import { NextRequest } from 'next/server';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

export default class AuditLogNextService extends AuditLogService {

  static extractRequestContext(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
    const ipAddress =
      clientIpOf(req.headers) ?? null;
    const userAgent = req.headers.get('user-agent') ?? null;
    return { ipAddress, userAgent };
  }
}
