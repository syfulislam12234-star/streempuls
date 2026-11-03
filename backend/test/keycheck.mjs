import { validateStreamKey } from '../streamDestinations.js';

const realYoutubeKeys = [
  'wvsa-xqza-4k8a-ufyu',
  'abcd-1234-5678-abcd-1234',
  '4k8a-ufyu-wvsa-xqza',
  'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'abcd1234efgh5678ijkl9012mnop3456',
  'a1b2-c3d4-e5f6-g7h8-i9j0-k1l2-m3n4-o5p6',
  'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH',
  'sc-0123456789abcdef0123456789abcdef',
  'key-with-multiple-dashes-and-12345',
  'live-abc123',
];

const completeUrls = [
  'rtmp://a.rtmp.youtube.com/live2/SECRETKEY',
  'rtmp://a.rtmp.youtube.com/live2',
  'rtmps://ingest.example.test/live/key',
];

let rejectCount = 0;
for (const k of realYoutubeKeys) {
  try {
    validateStreamKey(k);
    console.log('ACCEPT  ', JSON.stringify(k));
  } catch (e) {
    rejectCount++;
    console.log('REJECT  ', JSON.stringify(k), '->', e.message);
  }
}
console.log('--- complete URLs (must be rejected) ---');
for (const k of completeUrls) {
  try {
    validateStreamKey(k);
    console.log('ACCEPTED(bad!)', JSON.stringify(k));
  } catch (e) {
    console.log('rejected ok ', JSON.stringify(k), '->', e.message);
  }
}
console.log('REAL_KEY_REJECT_COUNT=' + rejectCount);