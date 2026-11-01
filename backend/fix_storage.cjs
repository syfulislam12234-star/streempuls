const fs = require('fs');
let s = fs.readFileSync('storage.js', 'utf8');

// Fix 1: CloudflareR2StorageAdapter constructor - add initPromise and ensureInitialized
let oldConstructor = "    this.s3Client = null;\n\n    if (this.accountId && this.accessKeyId && this.secretAccessKey) {\n      try {\n        // Dynamically import AWS SDK if available in environment\n        import('@aws-sdk/client-s3').then(({ S3Client }) => {\n          this.s3Client = new S3Client({\n            region: 'auto',\n            endpoint: (process.env.CLOUDFLARE_R2_ENDPOINT?.trim() || `https://${this.accountId}.r2.cloudflarestorage.com`).replace(/\\/+$/, ''),\n            forcePathStyle: true,\n            credentials: {\n              accessKeyId: this.accessKeyId,\n              secretAccessKey: this.secretAccessKey,\n            },\n          });\n        }).catch(() => {\n          console.warn('[Cloudflare R2 Adapter] @aws-sdk/client-s3 not loaded; fallback to public URL generator.');\n        });\n      } catch (e) {}\n    }\n  }\n\n  getPublicUrl(fileName) {";

let newConstructor = "    this.s3Client = null;\n    this.initPromise = null;\n\n    if (this.accountId && this.accessKeyId && this.secretAccessKey) {\n      this.initPromise = (async () => {\n        try {\n          const { S3Client } = await import('@aws-sdk/client-s3');\n          this.s3Client = new S3Client({\n            region: 'auto',\n            endpoint: (process.env.CLOUDFLARE_R2_ENDPOINT?.trim() || `https://${this.accountId}.r2.cloudflarestorage.com`).replace(/\\/+$/, ''),\n            forcePathStyle: true,\n            credentials: {\n              accessKeyId: this.accessKeyId,\n              secretAccessKey: this.secretAccessKey,\n            },\n          });\n        } catch (err) {\n          console.warn('[Cloudflare R2 Adapter] Failed to initialize S3 client:', err.message);\n          this.s3Client = null;\n        }\n      })();\n    }\n  }\n\n  async ensureInitialized() {\n    if (this.initPromise) {\n      await this.initPromise;\n    }\n  }\n\n  getPublicUrl(fileName) {";

if (!s.includes(oldConstructor)) {
  // Try CRLF
  oldConstructor = oldConstructor.replace(/\n/g, '\r\n');
  newConstructor = newConstructor.replace(/\n/g, '\r\n');
  if (!s.includes(oldConstructor)) {
    console.log('OLD CONSTRUCTOR NOT FOUND');
    let idx = s.indexOf('this.s3Client = null');
    console.log('DEBUG:', JSON.stringify(s.slice(idx - 30, idx + 300)));
    process.exit(1);
  }
}
s = s.replace(oldConstructor, newConstructor);
console.log('Constructor replaced OK');

// Fix 2: getSignedUrl - ensureInitialized, throw on failure, no unsigned fallback
let oldGetSignedUrl = "  async getSignedUrl(fileName, expiresInSeconds = 86400) {\n    const cleanPath = fileName.replace(/^\\/+/, '');\n    if (this.s3Client) {\n      try {\n        const { GetObjectCommand } = await import('@aws-sdk/client-s3');\n        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');\n        const command = new GetObjectCommand({ Bucket: this.bucket, Key: cleanPath });\n        return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });\n      } catch (err) {\n        console.warn('[Cloudflare R2 Adapter] Presigned URL fallback:', err.message);\n      }\n    }\n    return this.getPublicUrl(cleanPath);\n  }";

let newGetSignedUrl = "  async getSignedUrl(fileName, expiresInSeconds = 86400) {\n    await this.ensureInitialized();\n    const cleanPath = fileName.replace(/^\\/+/, '');\n    if (!this.s3Client) {\n      throw new Error('Cloudflare R2 S3 client not initialized. Check credentials and configuration.');\n    }\n    try {\n      const { GetObjectCommand } = await import('@aws-sdk/client-s3');\n      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');\n      const command = new GetObjectCommand({ Bucket: this.bucket, Key: cleanPath });\n      return await getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });\n    } catch (err) {\n      throw new Error('Cloudflare R2 signing failed: ' + err.message);\n    }\n  }";

if (!s.includes(oldGetSignedUrl)) {
  oldGetSignedUrl = oldGetSignedUrl.replace(/\n/g, '\r\n');
  newGetSignedUrl = newGetSignedUrl.replace(/\n/g, '\r\n');
  if (!s.includes(oldGetSignedUrl)) {
    console.log('OLD GETSIGNEDURL NOT FOUND');
    process.exit(1);
  }
}
s = s.replace(oldGetSignedUrl, newGetSignedUrl);
console.log('getSignedUrl replaced OK');

fs.writeFileSync('storage.js', s, 'utf8');
console.log('storage.js written successfully');