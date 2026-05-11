import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AppError, ErrorCode } from '@/libs/app-error';
import { Logger } from '@/libs/logger';
import { env } from '@/libs/env';
import { StorageMessages } from './storage.messages';
import type { PresignedUploadResult, PresignedDownloadResult } from './storage.types';
import type { GetUploadUrlInput, GetDownloadUrlInput } from './storage.dto';

const UPLOAD_EXPIRY_SECONDS = 15 * 60;   // 15 minutes
const DOWNLOAD_EXPIRY_SECONDS = 60 * 60; // 1 hour

export default class StorageService {
  private static getConfig(): { bucket: string; region: string; accessKeyId: string; secretAccessKey: string } {
    const bucket = env.AWS_S3_BUCKET ?? env.AWS_S3_BUCKET;
    const region = env.AWS_S3_REGION ?? env.AWS_REGION ?? 'us-east-1';
    const accessKeyId = env.AWS_S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.AWS_S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;

    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new AppError('AWS S3 is not configured', 500, ErrorCode.INTERNAL_ERROR);
    }

    return { bucket, region, accessKeyId, secretAccessKey };
  }

  static generateKey(filename: string, tenantId?: string): string {
    const id = uuidv4();
    const prefix = tenantId ? `${tenantId}/uploads/${id}` : `uploads/${id}`;
    return `${prefix}/${filename}`;
  }

  /**
   * Sign an AWS S3 presigned URL using AWS Signature Version 4.
   */
  private static signPresignedUrl(
    method: 'PUT' | 'GET' | 'DELETE',
    key: string,
    expiresIn: number,
    contentType?: string,
  ): string {
    const { bucket, region, accessKeyId, secretAccessKey } = StorageService.getConfig();

    const now = new Date();
    const datestamp = now.toISOString().split('T')[0].replace(/-/g, '');
    const timestamp = now.toISOString().replace(/[:-]/g, '').split('.')[0] + 'Z';

    const host = `${bucket}.s3.${region}.amazonaws.com`;
    const canonicalUri = `/${key}`;
    const credentialScope = `${datestamp}/${region}/s3/aws4_request`;
    const credential = `${accessKeyId}/${credentialScope}`;

    const signedHeaders = 'host';

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': timestamp,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': signedHeaders,
    };

    if (contentType && method === 'PUT') {
      queryParams['Content-Type'] = contentType;
    }

    const canonicalQueryString = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');

    const canonicalHeaders = `host:${host}\n`;
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    const signingKey = StorageService.deriveSigningKey(secretAccessKey, datestamp, region);
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    queryParams['X-Amz-Signature'] = signature;

    const finalQuery = Object.keys(queryParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
      .join('&');

    return `https://${host}${canonicalUri}?${finalQuery}`;
  }

  private static deriveSigningKey(secretAccessKey: string, datestamp: string, region: string): Buffer {
    const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(datestamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    return kSigning;
  }

  static async getPresignedUploadUrl(data: GetUploadUrlInput): Promise<PresignedUploadResult> {
    try {
      const key = StorageService.generateKey(data.filename, data.tenantId);
      const uploadUrl = StorageService.signPresignedUrl('PUT', key, UPLOAD_EXPIRY_SECONDS, data.contentType);

      Logger.info(`[Storage] Presigned upload URL created for key: ${key}`);

      return {
        uploadUrl,
        key,
        expiresIn: UPLOAD_EXPIRY_SECONDS,
      };
    } catch (err) {
      Logger.error(`[Storage] Failed to create upload URL: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  static async getPresignedDownloadUrl(data: GetDownloadUrlInput): Promise<PresignedDownloadResult> {
    try {
      const downloadUrl = StorageService.signPresignedUrl('GET', data.key, DOWNLOAD_EXPIRY_SECONDS);

      Logger.info(`[Storage] Presigned download URL created for key: ${data.key}`);

      return {
        downloadUrl,
        expiresIn: DOWNLOAD_EXPIRY_SECONDS,
      };
    } catch (err) {
      Logger.error(`[Storage] Failed to create download URL: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  static async deleteFile(key: string): Promise<void> {
    try {
      const { bucket, region } = StorageService.getConfig();
      const deleteUrl = StorageService.signPresignedUrl('DELETE', key, 300);

      const response = await fetch(deleteUrl, { method: 'DELETE' });

      if (!response.ok && response.status !== 204) {
        throw new AppError(StorageMessages.FILE_NOT_FOUND, response.status, ErrorCode.NOT_FOUND);
      }

      Logger.info(`[Storage] File deleted: ${key} from ${bucket} (${region})`);
    } catch (err) {
      if (err instanceof AppError) throw err;
      Logger.error(`[Storage] Failed to delete file: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }
}
