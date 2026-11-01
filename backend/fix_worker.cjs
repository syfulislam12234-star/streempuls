const fs = require('fs');
let s = fs.readFileSync('worker.js', 'utf8');

function replaceOnce(oldStr, newStr, label) {
  if (!s.includes(oldStr)) {
    let oc = oldStr.replace(/\n/g, '\r\n');
    let nc = newStr.replace(/\n/g, '\r\n');
    if (!s.includes(oc)) {
      console.log(label + ' - NOT FOUND');
      return false;
    }
    s = s.replace(oc, nc);
  } else {
    s = s.replace(oldStr, newStr);
  }
  console.log(label + ' - OK');
  return true;
}

// Change 0: Add variable declarations for signed URL tracking
let oldDecl = `  let inputSource = videoUrl;
  if (videoUrl && !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {`;
let newDecl = `  let inputSource = videoUrl;
  let signedUrlGeneratedAt = null;
  let signedUrlTtlMs = null;
  if (videoUrl && !videoUrl.startsWith('http://') && !videoUrl.startsWith('https://')) {`;
replaceOnce(oldDecl, newDecl, 'Change 0: Variable declarations');

// Change 1: HTTP(S) URL signing block - pass shorter TTL, track generation time
let oldSigning = `        const signedUrl = await provider.getSignedUrl(objectKey);
        if (signedUrl && signedUrl !== videoUrl) {
          inputSource = signedUrl;
        }`;
let newSigning = `        const signedUrl = await provider.getSignedUrl(objectKey, 3600);
        if (signedUrl && signedUrl !== videoUrl) {
          inputSource = signedUrl;
          signedUrlGeneratedAt = Date.now();
          signedUrlTtlMs = 3600 * 1000;
        }`;
replaceOnce(oldSigning, newSigning, 'Change 1: URL signing TTL + tracking');