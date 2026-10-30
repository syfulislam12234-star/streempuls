/**
 * Supabase Admin Client
 * Uses SUPABASE_SERVICE_ROLE_KEY for trusted backend operations,
 * worker telemetry updates, and administrative overrides.
 * Seamlessly integrates with the modular storage provider adapter architecture.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  storageProvider,
  getPublicStorageUrl as getProviderPublicUrl,
  getSignedStorageUrl as getProviderSignedUrl,
  SUPABASE_STORAGE_BUCKET,
  STORAGE_PROVIDER,
} from './storage.js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Supabase Warning] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing from environment.');
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseServiceKey || 'placeholder_key', {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  realtime: {
    transport: typeof WebSocket !== 'undefined' ? WebSocket : undefined,
    timeout: 30000,
    heartbeatIntervalMs: 15000,
  },
});

export { SUPABASE_STORAGE_BUCKET, STORAGE_PROVIDER };

/**
 * Retrieves the public URL of an asset stored via the active modular storage provider.
 * Defaults to Supabase Storage ('stream-assets') with R2 S3-compatibility fallback.
 * @param {string} fileName 
 * @returns {string} Public URL
 */
export function getPublicStorageUrl(fileName) {
  return getProviderPublicUrl(fileName);
}

/**
 * Creates a signed URL for an asset with custom expiration.
 * @param {string} fileName
 * @param {number} expiresInSeconds
 * @returns {Promise<string>} Signed URL
 */
export async function getSignedStorageUrl(fileName, expiresInSeconds = 86400) {
  return getProviderSignedUrl(fileName, expiresInSeconds);
}
