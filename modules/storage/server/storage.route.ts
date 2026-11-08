import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { isIP } from "node:net";
import { getProvider, getStorageSettings } from "@kuraykaraaslan-labs/storage/server/storage.provider-factory";
import { AppError, ErrorCode } from "@kuraykaraaslan-labs/common/server/app-error";
import { clientIpOf } from '@kuraykaraaslan-labs/ip_subnet/server/ip_subnet.client-ip';

/**
 * POST /tenant/[tenantId]/api/storage
 * Upload a file to storage for a tenant
 *
 * Body (FormData):
 * - file: File (required)
 * - folder: string (optional, default: 'general')
 * - provider: StorageProviderType (optional, uses default)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'storage.files.upload', scope: 'TENANT' });
    // 413 from the declared size before formData() buffers the whole body.
    await StorageService.assertDeclaredUploadSize(tenantId, request.headers.get('content-length'));
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folder = (formData.get('folder') as string) || 'general';
    const providerField = formData.get('provider');
    const provider = typeof providerField === 'string' && providerField.length > 0 ? providerField as any : undefined;

    if (!file) {
      return NextResponse.json(
        { message: 'File is required' },
        { status: 400 }
      );
    }

    // storage.02: the form field is a request, not an entitlement. A name that is not installed stays a 400 (getProvider);
    // an installed backend other than the tenant default is refused: the member upload path writes to the default only.
    if (provider !== undefined) {
      await getProvider(tenantId, provider);
      const { providerName } = await getStorageSettings(tenantId);
      if (provider !== providerName) throw new AppError('This storage backend cannot be chosen for an upload', 403, ErrorCode.FORBIDDEN);
    }

    // Capture upload origin for fraud / GDPR audit (country is inferred from IP
    // server-side). storage.07: only a syntactically valid address is kept (the last
    // X-Forwarded-For hop, the one the platform's proxy appended); anything else is not stored.
    const candidate = clientIpOf(request.headers);
    const ip = candidate && isIP(candidate) ? candidate : undefined;
    const userAgent = request.headers.get('user-agent')?.slice(0, 512) ?? undefined;
    const userId = (auth as any)?.user?.userId ?? (auth as any)?.user?.id ?? undefined;

    const result = await StorageService.uploadFile(tenantId, {
      file,
      folder: folder,
      tenantId,
      provider,
      userId,
      origin: { ip, userAgent },
    });

    return NextResponse.json({
      message: 'File uploaded successfully',
      uploadedFileId: result.uploadedFileId,
      url: result.url,
      key: result.key,
      bucket: result.bucket,
      size: result.size,
      provider: result.provider,
    });
  } catch (e) {
    return normalizeError(e);
  }
}
