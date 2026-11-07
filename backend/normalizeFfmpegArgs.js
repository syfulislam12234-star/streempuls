import path from 'node:path';

/**
 * Keep Matroska sources in Matroska, which can carry a wider range of codecs.
 * MOV and MP4 are remuxed into MP4; incompatible streams fail rather than
 * silently being transcoded.
 */
export function getStreamCopyOutputDetails(sourceReference) {
  let sourcePath = String(sourceReference || '');
  try {
    sourcePath = new URL(sourcePath).pathname;
  } catch {}

  if (path.extname(sourcePath).toLowerCase() === '.mkv') {
    return { extension: '.mkv', contentType: 'video/x-matroska' };
  }
  return { extension: '.mp4', contentType: 'video/mp4' };
}

/** Build a remux-only FFmpeg command: no filters and no audio/video encoders. */
export function buildNormalizeFfmpegArgs(inputPath, outputPath) {
  const args = [
    '-y',
    '-i', inputPath,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    '-dn',
    '-c', 'copy',
  ];

  if (path.extname(outputPath).toLowerCase() === '.mp4') {
    args.push('-movflags', '+faststart');
  }

  args.push(outputPath);
  return args;
}