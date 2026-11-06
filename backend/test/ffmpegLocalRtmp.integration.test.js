import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import test from 'node:test';
import { terminateChildAndWait, scheduleRestartAfterExit } from '../ffmpegLifecycle.js';

const execFileAsync = promisify(execFile);
const integrationEnabled = process.env.RUN_FFMPEG_RTMP_INTEGRATION === '1';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode != null || child.signalCode != null) return;
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Local FFmpeg process did not exit in time.')), timeoutMs)),
  ]);
}

function startSink(ffmpeg, inputUrl) {
  return spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-listen', '1',
    '-i', inputUrl,
    '-t', '60',
    '-f', 'null', '-',
  ], { stdio: 'ignore' });
}

function startSender(ffmpeg, videoPath, outputUrl) {
  return spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-re', '-stream_loop', '-1',
    '-i', videoPath,
    '-c:v', 'copy', '-an',
    '-f', 'flv', outputUrl,
  ], { stdio: 'ignore' });
}

test('local FFmpeg sender recovers after unexpected exit and stops without overlapping senders', {
  skip: !integrationEnabled && 'Set RUN_FFMPEG_RTMP_INTEGRATION=1 to run the real local FFmpeg/RTMP test.',
}, async (t) => {
  try { await execFileAsync(ffmpegPath, ['-version'], { timeout: 5_000 }); }
  catch { t.skip('FFmpeg is not installed or FFMPEG_PATH is invalid.'); return; }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'streempulse-ffmpeg-rtmp-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const videoPath = path.join(directory, 'fixture.mp4');
  try {
    await execFileAsync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15',
      '-t', '4', '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-g', '15', '-y', videoPath,
    ], { timeout: 20_000 });
  } catch (error) {
    t.skip(`Local FFmpeg cannot generate the H.264 fixture: ${error.message}`);
    return;
  }

  const port = await reserveLoopbackPort();
  const inputUrl = `rtmp://127.0.0.1:${port}/live/test`;
  const outputUrl = inputUrl;
  let sink = startSink(ffmpegPath, inputUrl);
  let sender = null;
  let activeSenders = 0;
  const senderChildren = new Set();
  const startTrackedSender = () => {
    assert.equal(activeSenders, 0, 'must not start while another FFmpeg sender is active');
    const child = startSender(ffmpegPath, videoPath, outputUrl);
    activeSenders++;
    senderChildren.add(child);
    child.once('exit', () => {
      activeSenders--;
      senderChildren.delete(child);
    });
    return child;
  };
  const stopIfRunning = async (child) => {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    await terminateChildAndWait(child, { gracePeriodMs: 200, forceKillWaitMs: 1_000 });
    if (child.exitCode == null && child.signalCode == null) {
      try { child.kill('SIGKILL'); } catch {}
      await waitForExit(child).catch(() => {});
    }
  };
  t.after(async () => {
    await Promise.all([...senderChildren].map(stopIfRunning));
    await stopIfRunning(sink);
  });

  await new Promise((resolve) => setTimeout(resolve, 150));
  sender = startTrackedSender();
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (sender.exitCode != null || sink.exitCode != null) {
    t.skip('This FFmpeg build does not support local RTMP listen mode as configured.');
    return;
  }

  sender.kill('SIGKILL');
  await waitForExit(sender);
  assert.equal(activeSenders, 0, 'unexpectedly exited sender must be gone before recovery');
  await stopIfRunning(sink);

  sink = startSink(ffmpegPath, inputUrl);
  await new Promise((resolve) => setTimeout(resolve, 150));
  let recovered;
  const restartScheduled = new Promise((resolve, reject) => {
    const timer = scheduleRestartAfterExit({
      child: sender,
      delayMs: 100,
      shouldRestart: () => true,
      restart: () => {
        try {
          recovered = startTrackedSender();
          resolve();
        } catch (error) { reject(error); }
      },
    });
    if (!timer) reject(new Error('Recovery was not scheduled after the failed sender exited.'));
  });
  await restartScheduled;
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.ok(recovered);
  assert.equal(recovered.exitCode, null, 'recovered sender should remain connected to local sink');
  assert.equal(activeSenders, 1);

  const stopped = await terminateChildAndWait(recovered, { gracePeriodMs: 200, forceKillWaitMs: 1_000 });
  assert.equal(stopped, true);
  assert.equal(activeSenders, 0, 'stop must complete after sender exit');
  await stopIfRunning(sink);
});
