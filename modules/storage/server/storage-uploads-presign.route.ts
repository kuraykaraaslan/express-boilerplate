import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { PresignUploadDTOSchema } from '@kuraykaraaslan-labs/storage/server/storage.dto';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * POST /tenant/[tenantId]/api/storage/uploads/presign
 * Browser-direct upload, step 1. Body (JSON): { name, size, type?, folder?, provider? }.
 *
 * Answers `{ mode: 'direct', uploadId, url, method, headers, expiresAt, maxBytes, multipartMaxBytes }`
 * (PUT the file to `url` with `headers`, then POST `uploadId` to .../uploads/complete), or
 * `{ mode: 'multipart', reason, maxBytes }` (POST the file to /api/storage as before).
 * The declaration is checked against the tenant's limits before anything is signed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'storage.files.upload', scope: 'TENANT' });
    const input = PresignUploadDTOSchema.parse(await request.json());

    const ip =
      clientIpOf(request.headers) ?? undefined;
    const userAgent = request.headers.get('user-agent') ?? undefined;

    const result = await StorageService.presignUpload(tenantId, input, {
      userId: auth.user.userId,
      origin: { ip, userAgent },
      purpose: 'storage',
    });
    return NextResponse.json(result);
  } catch (e) {
    return normalizeError(e);
  }
}
