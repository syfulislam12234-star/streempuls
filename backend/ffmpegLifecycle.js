/** Wait for the exact FFmpeg child to exit before allowing protected resources to be released. */
export function terminateChildAndWait(child, { gracePeriodMs = 5_000, forceKillWaitMs = 5_000 } = {}) {
  if (!child || child.exitCode != null || child.signalCode != null) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let forceKillTimer;
    let finalTimer;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(finalTimer);
      child.removeListener?.('exit', onExit);
      child.removeListener?.('close', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);

    child.once?.('exit', onExit);
    child.once?.('close', onExit);
    forceKillTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { finish(false); return; }
      finalTimer = setTimeout(() => finish(false), forceKillWaitMs);
      finalTimer.unref?.();
    }, gracePeriodMs);
    forceKillTimer.unref?.();

    try { child.kill('SIGTERM'); } catch { finish(false); }
  });
}

/** Release cache protection only after child exit is confirmed. */
export async function terminateChildAndReleaseCache(child, releaseCache, options) {
  const exited = await terminateChildAndWait(child, options);
  const exitConfirmed = exited || !child || child.exitCode != null || child.signalCode != null;
  if (exitConfirmed) {
    await releaseCache?.();
    return true;
  }

  let released = false;
  const releaseOnce = async () => {
    if (released) return;
    released = true;
    await releaseCache?.();
  };
  child?.once?.('exit', releaseOnce);
  child?.once?.('close', releaseOnce);
  if (child?.exitCode != null || child?.signalCode != null) await releaseOnce();
  return false;
}

/** Schedule a retry only after the previous FFmpeg child has exited. */
export function scheduleRestartAfterExit({ child, delayMs, shouldRestart, restart }) {
  if (child && child.exitCode == null && child.signalCode == null) return null;
  const timer = setTimeout(() => {
    if (shouldRestart()) void Promise.resolve(restart()).catch(() => {});
  }, Math.max(0, delayMs));
  timer.unref?.();
  return timer;
}
