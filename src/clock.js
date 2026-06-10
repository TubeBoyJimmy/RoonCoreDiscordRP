const { execFile } = require("child_process");
const { createLogger } = require("./logger");

const log = createLogger("Clock");

/**
 * System clock offset compensation.
 *
 * Discord renders elapsed time as (viewer's clock − timestamps.start) with no
 * correction, so a skewed sender clock shifts the displayed position 1:1 for
 * every viewer. We measure our own offset against a trusted HTTPS Date header
 * and apply it to outgoing timestamps, making them correct in true time
 * regardless of the local clock.
 *
 * Uses system curl.exe (same as images.js) — Node's network stack is
 * firewall-blocked for external hosts on some setups.
 */

const SYNC_URLS = ["https://discord.com", "https://www.google.com"];
const SAMPLES_PER_SYNC = 3;
const RESYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // clock drift is slow; 6h is plenty
// Date headers have 1s resolution; offsets within noise are treated as zero
// rather than "corrected" into ±1s of error on healthy machines.
const APPLY_THRESHOLD_MS = 2000;

// Wall-clock vs monotonic divergence beyond this means the OS stepped the
// clock (NTP sync, manual change) — the applied offset is instantly stale
const STEP_DETECT_INTERVAL_MS = 30 * 1000;
const STEP_DETECT_THRESHOLD_MS = 1500;

let offsetMs = 0; // add to local epoch ms to get true epoch ms
let measuredMs = null; // raw measurement (null = never succeeded)
let resyncTimer = null;
let stepTimer = null;

function _sampleOnce(url) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    execFile(
      "curl",
      ["-sI", "--max-time", "10", url],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        const t1 = Date.now();
        if (err) return reject(new Error(err.message));
        const m = String(stdout).match(/^date:\s*(.+)$/im);
        if (!m) return reject(new Error("no Date header"));
        const serverMs = Date.parse(m[1].trim());
        if (Number.isNaN(serverMs)) return reject(new Error("unparseable Date header"));
        const rtt = t1 - t0;
        // Server stamped the header mid-roundtrip; +500ms centers the
        // header's 1-second truncation.
        resolve({ offset: serverMs + 500 - (t0 + rtt / 2), rtt });
      }
    );
  });
}

async function sync() {
  const samples = [];
  for (const url of SYNC_URLS) {
    for (let i = 0; i < SAMPLES_PER_SYNC; i++) {
      try {
        samples.push(await _sampleOnce(url));
      } catch (err) {
        log.debug(`Clock sample failed (${url}): ${err.message}`);
        break; // try next URL
      }
    }
    if (samples.length >= SAMPLES_PER_SYNC) break;
  }

  if (samples.length === 0) {
    log.warn("Clock sync failed (no network?), timestamps use local clock as-is");
    return offsetMs;
  }

  // Lowest-RTT sample has the least midpoint uncertainty
  samples.sort((a, b) => a.rtt - b.rtt);
  measuredMs = Math.round(samples[0].offset);

  if (Math.abs(measuredMs) >= APPLY_THRESHOLD_MS) {
    offsetMs = measuredMs;
    log.warn(
      `System clock is ${(Math.abs(measuredMs) / 1000).toFixed(1)}s ${measuredMs > 0 ? "behind" : "ahead of"} true time — compensating Discord timestamps`
    );
  } else {
    offsetMs = 0;
    log.info(`System clock OK (offset ${measuredMs}ms, within noise)`);
  }
  return offsetMs;
}

function startPeriodicSync() {
  if (resyncTimer) return;
  resyncTimer = setInterval(() => {
    sync().catch(() => {});
  }, RESYNC_INTERVAL_MS);
  if (resyncTimer.unref) resyncTimer.unref();

  // Detect external clock steps (w32time kicking in after boot, manual
  // change, resume from sleep) — a stale applied offset is worse than none
  let lastWall = Date.now();
  let lastMono = process.hrtime.bigint();
  stepTimer = setInterval(() => {
    const wallDelta = Date.now() - lastWall;
    const monoDelta = Number(process.hrtime.bigint() - lastMono) / 1e6;
    lastWall = Date.now();
    lastMono = process.hrtime.bigint();
    if (Math.abs(wallDelta - monoDelta) > STEP_DETECT_THRESHOLD_MS) {
      log.info(
        `System clock step detected (${Math.round(wallDelta - monoDelta)}ms), re-measuring offset`
      );
      // The applied offset is now known-stale — drop it immediately so a
      // failed re-measure (offline) can't leave a doubly-wrong correction
      offsetMs = 0;
      measuredMs = null;
      sync().catch(() => {});
    }
  }, STEP_DETECT_INTERVAL_MS);
  if (stepTimer.unref) stepTimer.unref();
}

function stopPeriodicSync() {
  if (resyncTimer) {
    clearInterval(resyncTimer);
    resyncTimer = null;
  }
  if (stepTimer) {
    clearInterval(stepTimer);
    stepTimer = null;
  }
}

/** Convert a local-clock epoch ms to true epoch ms. */
function toTrue(localMs) {
  return localMs + offsetMs;
}

/** Current true epoch ms. */
function trueNow() {
  return Date.now() + offsetMs;
}

function getOffsetMs() {
  return offsetMs;
}

module.exports = { sync, startPeriodicSync, stopPeriodicSync, toTrue, trueNow, getOffsetMs };
