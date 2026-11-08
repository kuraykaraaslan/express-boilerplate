import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from 'next/server';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { CompleteUploadDTOSchema } from '@kuraykaraaslan-labs/storage/server/storage.dto';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/storage/uploads/complete
 * Browser-direct upload, step 3. Body (JSON): { uploadId }.
 *
 * Verifies the object the browser PUT (size, type, magic bytes), records it and
 * answers what the multipart upload route answers. Only the user who presigned
 * the upload, in the same tenant, can complete it; a repeated call returns the
 * same file instead of recording a second one.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'storage.files.upload', scope: 'TENANT' });
    const { uploadId } = CompleteUploadDTOSchema.parse(await request.json());

    const { upload } = await StorageService.completeUpload(tenantId, uploadId, { userId: auth.user.userId, purpose: 'storage' });
    return NextResponse.json({
      message: 'File uploaded successfully',
      uploadedFileId: upload.uploadedFileId,
      url: upload.url,
      key: upload.key,
      bucket: upload.bucket,
      size: upload.size,
      provider: upload.provider,
    });
  } catch (e) {
    return normalizeError(e);
  }
}
