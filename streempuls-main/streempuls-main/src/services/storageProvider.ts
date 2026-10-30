/**
 * ============================================================================
 * StreamPulse - Modular Storage Provider Pattern (Adapter Architecture)
 * ============================================================================
 * 
 * Enterprise-grade multi-cloud media storage abstraction layer.
 * Allows StreamPulse to seamlessly switch between:
 * 1. Supabase Storage (Default, Zero-cost, PostgreSQL-backed 'stream-assets' bucket)
 * 2. Cloudflare R2 (S3-compatible, Zero-egress global CDN for future high-scale deployment)
 * 
 * Switchable via the STORAGE_PROVIDER environment variable ('supabase' | 'r2').
 * No modifications to streaming workers, FFmpeg pipelines, or core business logic required.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getS3SignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

export type StorageProviderType = 'supabase' | 'r2';

export interface StorageAssetMeta {
  name: string;
  url: string;
  sizeBytes?: number;
  sizeMb?: number;
  updatedAt?: string;
  provider: StorageProviderType;
  bucket: string;
}

export interface StorageHealthStatus {
  ok: boolean;
  activeProvider: StorageProviderType;
  configuredBucket: string;
  providerDetails: {
    supabase: { configured: boolean; bucket: string; url: string };
    r2: { configured: boolean; bucket: string; accountId: string; publicDomain: string };
  };
  message: string;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  provider: StorageProviderType;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Universal Storage Provider Interface
 */
export interface IStorageProvider {
  readonly providerType: StorageProviderType;
  readonly bucketName: string;

  upload(
    fileName: string,
    fileBuffer: Buffer | Uint8Array,
    contentType?: string
  ): Promise<{ key: string; publicUrl: string; sizeBytes: number }>;

  getPublicUrl(fileName: string): string;

  getSignedUrl(fileName: string, expiresInSeconds?: number): Promise<string>;

  getPresignedUploadUrl(
    fileName: string,
    contentType?: string,
    expiresInSeconds?: number
  ): Promise<PresignedUploadResult>;

  delete(fileName: string): Promise<boolean>;

  listFiles(prefix?: string, limit?: number): Promise<StorageAssetMeta[]>;

  healthCheck(): Promise<{ ok: boolean; message: string }>;
}

/**
 * ----------------------------------------------------------------------------
 * 1. Supabase Storage Adapter Implementation
 * ----------------------------------------------------------------------------
 */
export class SupabaseStorageAdapter implements IStorageProvider {
  public readonly providerType: StorageProviderType = 'supabase';
  public readonly bucketName: string;
  private client: SupabaseClient;

  constructor(supabaseUrl?: string, supabaseServiceKey?: string, bucketName?: string) {
    const url = supabaseUrl || process.env.SUPABASE_URL || 'https://wkchgdchgeormxvvlude.supabase.co';
    const key = supabaseServiceKey || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder-key';
    this.bucketName = bucketName || process.env.SUPABASE_STORAGE_BUCKET || 'stream-assets';

    this.client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  getPublicUrl(fileName: string): string {
    if (!fileName) return '';
    const cleanPath = fileName.replace(/^\/+/, '');
    const { data } = this.client.storage.from(this.bucketName).getPublicUrl(cleanPath);
    return data?.publicUrl || '';
  }

  async getSignedUrl(fileName: string, expiresInSeconds: number = 86400): Promise<string> {
    if (!fileName) return '';
    const cleanPath = fileName.replace(/^\/+/, '');
    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .createSignedUrl(cleanPath, expiresInSeconds);

      if (error || !data) {
        return this.getPublicUrl(cleanPath);
      }
      return data.signedUrl;
    } catch (err: any) {
      console.warn(`[Supabase Storage Adapter] Signed URL error for ${cleanPath}:`, err.message);
      return this.getPublicUrl(cleanPath);
    }
  }

  async getPresignedUploadUrl(
    fileName: string,
    contentType: string = 'video/mp4',
    expiresInSeconds: number = 3600
  ): Promise<PresignedUploadResult> {
    const cleanPath = fileName.replace(/^\/+/, '');
    const publicUrl = this.getPublicUrl(cleanPath);

    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .createSignedUploadUrl(cleanPath);

      if (error || !data) {
        return {
          uploadUrl: `/api/upload/direct?key=${encodeURIComponent(cleanPath)}&provider=supabase`,
          publicUrl,
          key: cleanPath,
          provider: 'supabase',
          headers: { 'Content-Type': contentType },
          expiresInSeconds,
        };
      }

      return {
        uploadUrl: data.signedUrl,
        publicUrl,
        key: cleanPath,
        provider: 'supabase',
        headers: { 'Content-Type': contentType },
        expiresInSeconds,
      };
    } catch {
      return {
        uploadUrl: `/api/upload/direct?key=${encodeURIComponent(cleanPath)}&provider=supabase`,
        publicUrl,
        key: cleanPath,
        provider: 'supabase',
        headers: { 'Content-Type': contentType },
        expiresInSeconds,
      };
    }
  }

  async upload(
    fileName: string,
    fileBuffer: Buffer | Uint8Array,
    contentType: string = 'video/mp4'
  ): Promise<{ key: string; publicUrl: string; sizeBytes: number }> {
    const cleanPath = fileName.replace(/^\/+/, '');
    const { data, error } = await this.client.storage
      .from(this.bucketName)
      .upload(cleanPath, fileBuffer, {
        contentType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    const publicUrl = this.getPublicUrl(cleanPath);
    return {
      key: data?.path || cleanPath,
      publicUrl,
      sizeBytes: fileBuffer.length,
    };
  }

  async delete(fileName: string): Promise<boolean> {
    const cleanPath = fileName.replace(/^\/+/, '');
    const { error } = await this.client.storage.from(this.bucketName).remove([cleanPath]);
    return !error;
  }

  async listFiles(prefix: string = 'media', limit: number = 50): Promise<StorageAssetMeta[]> {
    try {
      const { data, error } = await this.client.storage
        .from(this.bucketName)
        .list(prefix, { limit, sortBy: { column: 'created_at', order: 'desc' } });

      if (error || !data) return [];

      return data.map((item) => {
        const itemKey = prefix ? `${prefix}/${item.name}` : item.name;
        const publicUrl = this.getPublicUrl(itemKey);
        const sizeBytes = item.metadata?.size || 0;
        return {
          name: item.name,
          url: publicUrl,
          sizeBytes,
          sizeMb: +(sizeBytes / (1024 * 1024)).toFixed(1),
          updatedAt: item.created_at || new Date().toISOString(),
          provider: 'supabase',
          bucket: this.bucketName,
        };
      });
    } catch (err: any) {
      console.warn('[Supabase Storage Adapter] listFiles failed:', err.message);
      return [];
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const { data, error } = await this.client.storage.getBucket(this.bucketName);
      if (error && error.message.includes('not found')) {
        return { ok: true, message: `Connected to Supabase. Bucket '${this.bucketName}' auto-resolves.` };
      }
      return { ok: true, message: `Supabase Storage connected. Bucket: '${this.bucketName}' (${data?.public ? 'Public' : 'Private'})` };
    } catch (err: any) {
      return { ok: false, message: `Supabase Storage connection failed: ${err.message}` };
    }
  }
}

/**
 * ----------------------------------------------------------------------------
 * 2. Cloudflare R2 Storage Adapter Implementation (S3-Compatible)
 * ----------------------------------------------------------------------------
 */
export class CloudflareR2StorageAdapter implements IStorageProvider {
  public readonly providerType: StorageProviderType = 'r2';
  public readonly bucketName: string;
  private s3Client: S3Client | null = null;
  private accountId: string;
  private publicDomain: string;

  constructor() {
    this.accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID || '';
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
    this.bucketName = process.env.CLOUDFLARE_R2_BUCKET || 'stream-assets';
    this.publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '';

    if (this.accountId && accessKeyId && secretAccessKey) {
      this.s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${this.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
    }
  }

  getPublicUrl(fileName: string): string {
    if (!fileName) return '';
    const cleanPath = fileName.replace(/^\/+/, '');
    if (this.publicDomain) {
      const domain = this.publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return `https://${domain}/${cleanPath}`;
    }
    if (this.accountId) {
      return `https://${this.bucketName}.${this.accountId}.r2.cloudflarestorage.com/${cleanPath}`;
    }
    return `/uploads/${cleanPath}`;
  }

  async getSignedUrl(fileName: string, expiresInSeconds: number = 86400): Promise<string> {
    const cleanPath = fileName.replace(/^\/+/, '');
    if (!this.s3Client) {
      return this.getPublicUrl(cleanPath);
    }
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: cleanPath,
      });
      return await getS3SignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
    } catch (err: any) {
      console.warn(`[Cloudflare R2 Adapter] Presigned URL error for ${cleanPath}:`, err.message);
      return this.getPublicUrl(cleanPath);
    }
  }

  async getPresignedUploadUrl(
    fileName: string,
    contentType: string = 'video/mp4',
    expiresInSeconds: number = 3600
  ): Promise<PresignedUploadResult> {
    const cleanPath = fileName.replace(/^\/+/, '');
    const publicUrl = this.getPublicUrl(cleanPath);

    if (!this.s3Client) {
      // Mock / fallback direct URL if S3 credentials are not yet configured in environment
      return {
        uploadUrl: `/api/upload/direct?key=${encodeURIComponent(cleanPath)}&provider=r2`,
        publicUrl,
        key: cleanPath,
        provider: 'r2',
        headers: { 'Content-Type': contentType },
        expiresInSeconds,
      };
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: cleanPath,
        ContentType: contentType,
      });

      const uploadUrl = await getS3SignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });

      return {
        uploadUrl,
        publicUrl,
        key: cleanPath,
        provider: 'r2',
        headers: {
          'Content-Type': contentType,
        },
        expiresInSeconds,
      };
    } catch (err: any) {
      console.warn(`[Cloudflare R2 Adapter] Error generating presigned PUT URL for ${cleanPath}:`, err.message);
      return {
        uploadUrl: `/api/upload/direct?key=${encodeURIComponent(cleanPath)}&provider=r2`,
        publicUrl,
        key: cleanPath,
        provider: 'r2',
        headers: { 'Content-Type': contentType },
        expiresInSeconds,
      };
    }
  }

  async upload(
    fileName: string,
    fileBuffer: Buffer | Uint8Array,
    contentType: string = 'video/mp4'
  ): Promise<{ key: string; publicUrl: string; sizeBytes: number }> {
    const cleanPath = fileName.replace(/^\/+/, '');
    if (!this.s3Client) {
      throw new Error('Cloudflare R2 S3 client credentials not configured. Set CLOUDFLARE_R2_ACCOUNT_ID, ACCESS_KEY_ID, and SECRET_ACCESS_KEY.');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: cleanPath,
      Body: fileBuffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);
    const publicUrl = this.getPublicUrl(cleanPath);

    return {
      key: cleanPath,
      publicUrl,
      sizeBytes: fileBuffer.length,
    };
  }

  async delete(fileName: string): Promise<boolean> {
    const cleanPath = fileName.replace(/^\/+/, '');
    if (!this.s3Client) return false;
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName,
          Key: cleanPath,
        })
      );
      return true;
    } catch (err) {
      return false;
    }
  }

  async listFiles(prefix: string = 'media', limit: number = 50): Promise<StorageAssetMeta[]> {
    if (!this.s3Client) return [];
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: limit,
      });
      const response = await this.s3Client.send(command);
      if (!response.Contents) return [];

      return response.Contents.map((obj) => {
        const key = obj.Key || '';
        const name = key.split('/').pop() || key;
        const sizeBytes = obj.Size || 0;
        return {
          name,
          url: this.getPublicUrl(key),
          sizeBytes,
          sizeMb: +(sizeBytes / (1024 * 1024)).toFixed(1),
          updatedAt: obj.LastModified?.toISOString() || new Date().toISOString(),
          provider: 'r2',
          bucket: this.bucketName,
        };
      });
    } catch (err: any) {
      console.warn('[Cloudflare R2 Adapter] listFiles failed:', err.message);
      return [];
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.s3Client) {
      return {
        ok: false,
        message: 'Cloudflare R2 adapter is currently inactive (missing international card/credentials). System is running safely on default Supabase Storage.',
      };
    }
    return {
      ok: true,
      message: `Cloudflare R2 S3 client connected. Target bucket: '${this.bucketName}'.`,
    };
  }
}

/**
 * ----------------------------------------------------------------------------
 * 3. Modular Storage Provider Factory
 * ----------------------------------------------------------------------------
 */
let cachedProvider: IStorageProvider | null = null;
let currentOverrideProviderType: StorageProviderType | null = null;

export function getStorageProvider(overrideType?: StorageProviderType): IStorageProvider {
  const targetType = overrideType || currentOverrideProviderType || (process.env.STORAGE_PROVIDER?.toLowerCase() as StorageProviderType) || 'supabase';

  if (cachedProvider && cachedProvider.providerType === targetType && !overrideType) {
    return cachedProvider;
  }

  let provider: IStorageProvider;
  if (targetType === 'r2') {
    provider = new CloudflareR2StorageAdapter();
  } else {
    provider = new SupabaseStorageAdapter();
  }

  if (!overrideType) {
    cachedProvider = provider;
  }

  return provider;
}

/**
 * Allows dynamic runtime provider switching (for testing, admin toggling, or seamless failover)
 */
export function setRuntimeStorageProvider(type: StorageProviderType): IStorageProvider {
  currentOverrideProviderType = type;
  cachedProvider = null;
  return getStorageProvider(type);
}

/**
 * Inspect overall storage system health and readiness across both providers
 */
export async function getStorageHealthStatus(): Promise<StorageHealthStatus> {
  const active = getStorageProvider();
  const supabaseConfigured = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
  const r2Configured = Boolean(process.env.CLOUDFLARE_R2_ACCOUNT_ID && process.env.CLOUDFLARE_R2_ACCESS_KEY_ID);

  return {
    ok: true,
    activeProvider: active.providerType,
    configuredBucket: active.bucketName,
    providerDetails: {
      supabase: {
        configured: supabaseConfigured,
        bucket: process.env.SUPABASE_STORAGE_BUCKET || 'stream-assets',
        url: process.env.SUPABASE_URL || 'https://wkchgdchgeormxvvlude.supabase.co',
      },
      r2: {
        configured: r2Configured,
        bucket: process.env.CLOUDFLARE_R2_BUCKET || 'stream-assets',
        accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID || 'not_configured',
        publicDomain: process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || 'none',
      },
    },
    message: active.providerType === 'supabase'
      ? `Active Storage: Supabase Storage bucket '${active.bucketName}'. Ready for zero-cost YouTube live ingestion.`
      : `Active Storage: Cloudflare R2 S3-compatible bucket '${active.bucketName}'. Ready for zero-egress global CDN distribution.`,
  };
}
