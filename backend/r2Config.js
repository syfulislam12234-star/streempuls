const INVALID_PLACEHOLDER = /^(your_|placeholder|change[-_ ]?me|<.*>)|example/i;

export function getR2Configuration(env = process.env) {
  const accountId = env.CLOUDFLARE_R2_ACCOUNT_ID?.trim();
  const config = {
    accountId,
    accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim() || env.AWS_ACCESS_KEY_ID?.trim(),
    secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim() || env.AWS_SECRET_ACCESS_KEY?.trim(),
    endpoint: (env.CLOUDFLARE_R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : ''))
      .replace(/\/+$/, ''),
    bucket: env.CLOUDFLARE_R2_BUCKET_NAME?.trim()
      || env.CLOUDFLARE_R2_BUCKET?.trim()
      || 'stream-assets',
  };
  const invalidKeys = Object.entries(config)
    .filter(([key, value]) => key !== 'bucket' && (!value || INVALID_PLACEHOLDER.test(value)))
    .map(([key]) => key);

  if (invalidKeys.length > 0) {
    const error = new Error(`Cloudflare R2 is not configured. Set valid values for: ${invalidKeys.join(', ')}.`);
    error.code = 'R2_CONFIG_MISSING';
    throw error;
  }

  return config;
}