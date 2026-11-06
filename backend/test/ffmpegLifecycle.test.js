import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { scheduleRestartAfterExit, terminateChildAndReleaseCache } from '../ffmpegLifecycle.js';

class FakeChild extends EventEmitter {
  exitCode = null;
  signalCode = null;
  killSignals = [];
  onKill;

  constructor(onKill = () => {}) {
    super();
    this.onKill = onKill;
  }

  kill(signal) {
    this.killSignals.push(signal);
    this.onKill(signal, this);
    return true;
  }

  exit(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

test('cache usage is retained until a running FFmpeg child emits exit', async () => {
  let released = 0;
  let child;
  child = new FakeChild((signal, current) => {
    if (signal === 'SIGTERM') setTimeout(() => current.exit(null, 'SIGTERM'), 15);
  });

  const termination = terminateChildAndReleaseCache(child, async () => { released++; }, {
    gracePeriodMs: 100,
    forceKillWaitMs: 100,
  });
  assert.deepEqual(child.killSignals, ['SIGTERM']);
  assert.equal(released, 0);
  assert.equal(await termination, true);
  assert.equal(released, 1);
});

test('SIGKILL fallback still waits for confirmed child exit before cache release', async () => {
  let released = 0;
  const child = new FakeChild((signal, current) => {
    if (signal === 'SIGKILL') setTimeout(() => current.exit(null, 'SIGKILL'), 10);
  });

  const termination = terminateChildAndReleaseCache(child, async () => { released++; }, {
    gracePeriodMs: 5,
    forceKillWaitMs: 100,
  });
  assert.equal(await termination, true);
  assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
  assert.equal(released, 1);
});

test('unconfirmed termination retains cache use and releases only on a later exit event', async () => {
  let released = 0;
  const child = new FakeChild();
  const termination = terminateChildAndReleaseCache(child, async () => { released++; }, {
    gracePeriodMs: 5,
    forceKillWaitMs: 5,
  });

  assert.equal(await termination, false);
  assert.equal(released, 0);
  child.exit(null, 'SIGKILL');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(released, 1);
});

test('recovery waits for the prior FFmpeg child and never overlaps processes', async () => {
  const previous = new FakeChild();
  let activeProcesses = 1;
  let started = 0;
  previous.once('exit', () => { activeProcesses--; });
  assert.equal(scheduleRestartAfterExit({
    child: previous,
    delayMs: 0,
    shouldRestart: () => true,
    restart: () => { started++; },
  }), null, 'must not schedule while previous child is running');
  assert.equal(started, 0);

  previous.exit(1);
  const timer = scheduleRestartAfterExit({
    child: previous,
    delayMs: 5,
    shouldRestart: () => true,
    restart: () => {
      assert.equal(activeProcesses, 0, 'old FFmpeg process must have exited before retry');
      activeProcesses++;
      started++;
    },
  });
  assert.ok(timer);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started, 1);
  assert.equal(activeProcesses, 1);
});

test('recovery is suppressed when stop wins during reconnect backoff', async () => {
  const previous = new FakeChild();
  previous.exit(1);
  let stopped = true;
  let started = 0;
  scheduleRestartAfterExit({
    child: previous,
    delayMs: 5,
    shouldRestart: () => !stopped,
    restart: () => { started++; },
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(started, 0);
});
