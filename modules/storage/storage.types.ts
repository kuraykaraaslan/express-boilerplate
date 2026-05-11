export interface PresignedUploadResult {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

export interface PresignedDownloadResult {
  downloadUrl: string;
  expiresIn: number;
}

export interface StorageFile {
  key: string;
  size: number;
  contentType: string;
  lastModified: Date;
}
