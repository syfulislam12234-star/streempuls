/**
 * ============================================================================
 * StreamPulse - Modular Storage Provider Pattern (Backend Adapter)
 * ============================================================================
 * 
 * Pluggable media storage abstraction layer for BullMQ workers and API Gateways.
 * Supports:
 * - 'supabase': Default active provider (PostgreSQL 15+ & Storage, bucket: 'stream-assets')
 * - 'r2': Switchable Cloudflare R2 S3-compatible provider for future scale
 * 
 * Configured via STORAGE_PROVIDER in environment variables.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

export const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || 'supabase').toLowerCase();
export const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'stream-assets';
export const CLOUDFLARE_R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.CLOUDFLARE_R2_BUCKET || 'stream-assets';

// Shared Supabase Admin Client
const supabaseUrl = process.env.SUPABASE_URL || 'https://wkchgdchgeormxvvlude.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'placeholder_key';

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

/**
 * 1. Supabase Storage Provider Adapter
 */
export class SupabaseStorageAdapter {
  constructor(bucket = SUPABASE_STORAGE_BUCKET) {
    this.name = 'supabase';
    this.bucket = bucket;
    this.client = supabase;
  }

  getPublicUrl(fileName) {
    if (!fileName) return '';
    const cleanPath = fileName.replace(/^\/+/, '');
    const { data } = this.client.storage.from(this.bucket).getPublicUrl(cleanPath);
    return data?.publicUrl || '';
  }

  async getSignedUrl(fileName, expiresInSeconds = 86400) {
    if (!fileName) return '';
    const cleanPath = fileName.replace(/^\/+/, '');
    try {
      const { data, error } = await this.client.storage
        .from(this.bucket)
        .createSignedUrl(cleanPath, expiresInSeconds);

      if (error || !data) {
        return this.getPublicUrl(cleanPath);
      }
      return data.signedUrl;
    } catch (err) {
      console.warn(`[Supabase Storage] Signed URL error for ${cleanPath}:`, err.message);
      return this.getPublicUrl(cleanPath);
    }
  }

  async upload(fileName, buffer, contentType = 'video/mp4') {
    const cleanPath = fileName.replace(/^\/+/, '');
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .upload(cleanPath, buffer, {
        contentType,
        upsert: true,
      });

    if (error) throw error;
    return {
      key: data?.path || cleanPath,
      publicUrl: this.getPublicUrl(cleanPath),
    };
  }

  async listFiles(prefix = 'media', limit = 50) {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, { limit, sortBy: { column: 'created_at', order: 'desc' } });

    if (error) return [];
    return (data || []).map((item) => ({
      name: item.name,
      url: this.getPublicUrl(`${prefix}/${item.name}`),
      sizeBytes: item.metadata?.size || 0,
      updatedAt: item.created_at,
      provider: 'supabase',
    }));
  }
}

/**
 * 2. Cloudflare R2 Storage Provider Adapter (S3-Compatible)
 */
export class CloudflareR2StorageAdapter {
  constructor() {
    this.name = 'r2';
    this.bucket = CLOUDFLARE_R2_BUCKET;
    this.accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID?.trim() || '';
    this.accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim() || '';
    this.secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim() || '';
    this.publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN || '';
    this.s3Client = null;

    if (this.accountId && this.accessKeyId && this.secretAccessKey) {
      try {
        // Dynamically import AWS SDK if available in environment
        import('@aws-sdk/client-s3').then(({ S3Client }) => {
          this.s3Client = new S3Client({
            region: 'auto',
            endpoint: (process.env.CLOUDFLARE_R2_ENDPOINT?.trim() || `https://${this.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, ''),
            forcePathStyle: true,
            credentials: {
              accessKeyId: this.accessKeyId,
              secretAccessKey: this.secretAccessKey,
            },
          });
        }).catch(() => {
          console.warn('[Cloudflare R2 Adapter] @aws-sdk/client-s3 not loaded; fallback to public URL generator.');
        });
      } catch (e) {}
    }
  }

  getPublicUrl(fileName) {
    if (!fileName) return '';
    const cleanPath = fileName.replace(/^\/+/, '');
    if (this.publicDomain) {
      const domain = this.publicDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return `https://${domain}/${cleanPath}`;
    }
    if (this.accountId) {
      return `https://${this.bucket}.${this.accountId}.r2.cloudflarestorage.com/${cleanPath}`;
    }
    return `/uploads/${cleanPath}`;
  }

  async getSignedUrl(fileName, expiresInSeconds = 86400) {
    const cleanPath = fileName.replace(/^\/+/, '');
    if (this.s3Client) {
      try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
        const command = new GetObjectCommand({ Bucket: this.bucket, Key: cleanPath });
        return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
      } catch (err) {
        console.warn('[Cloudflare R2 Adapter] Presigned URL fallback:', err.message);
      }
    }
    return this.getPublicUrl(cleanPath);
  }

  async upload(fileName, buffer, contentType = 'video/mp4') {
    const cleanPath = fileName.replace(/^\/+/, '');
    if (!this.s3Client) {
      throw new Error('Cloudflare R2 S3 client credentials not configured. Switch to STORAGE_PROVIDER=supabase.');
    }
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await this.s3Client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: cleanPath,
      Body: buffer,
      ContentType: contentType,
    }));
    return {
      key: cleanPath,
      publicUrl: this.getPublicUrl(cleanPath),
    };
  }

  async listFiles(prefix = 'media', limit = 50) {
    if (!this.s3Client) return [];
    try {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const response = await this.s3Client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: limit,
      }));
      return (response.Contents || []).map((item) => ({
        name: item.Key.split('/').pop(),
        url: this.getPublicUrl(item.Key),
        sizeBytes: item.Size || 0,
        updatedAt: item.LastModified,
        provider: 'r2',
      }));
    } catch (e) {
      return [];
    }
  }
}

/**
 * 3. Storage Provider Factory & Singleton Dispatcher
 */
let currentProviderInstance = null;

export function getStorageProvider(requestedProvider) {
  const providerType = requestedProvider || process.env.STORAGE_PROVIDER || 'supabase';
  if (currentProviderInstance && currentProviderInstance.name === providerType) {
    return currentProviderInstance;
  }

  if (providerType.toLowerCase() === 'r2') {
    currentProviderInstance = new CloudflareR2StorageAdapter();
  } else {
    currentProviderInstance = new SupabaseStorageAdapter();
  }
  return currentProviderInstance;
}

// Active singleton instance
export const storageProvider = getStorageProvider();

// Helper export functions
export function getPublicStorageUrl(fileName) {
  return storageProvider.getPublicUrl(fileName);
}

export async function getSignedStorageUrl(fileName, expiresInSeconds = 86400) {
  return storageProvider.getSignedUrl(fileName, expiresInSeconds);
}
