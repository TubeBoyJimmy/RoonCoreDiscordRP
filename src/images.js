const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cache = require("./cache");
const { createLogger } = require("./logger");

const log = createLogger("Images");

/**
 * Image upload providers — tried in order until one succeeds.
 * Uses system curl.exe to bypass Electron's network restrictions entirely.
 */
const PROVIDERS = [
  {
    name: "Uguu",
    curlArgs: (filePath) => [
      "-s", "--max-time", "20",
      "-F", `files[]=@${filePath};type=image/jpeg;filename=cover.jpg`,
      "https://uguu.se/upload",
    ],
    parseUrl: (stdout) => {
      try {
        const json = JSON.parse(stdout);
        if (json.success && json.files?.[0]?.url) {
          return json.files[0].url.replace(/\\\//g, "/");
        }
      } catch {}
      return null;
    },
    cacheTtl: 40 * 60 * 60 * 1000, // 40 hours (48h host, re-upload before expiry)
  },
  {
    name: "Catbox",
    curlArgs: (filePath) => [
      "-s", "--max-time", "20",
      "-F", "reqtype=fileupload",
      `-F`, `fileToUpload=@${filePath};type=image/jpeg;filename=cover.jpg`,
      "https://catbox.moe/user/api.php",
    ],
    parseUrl: (stdout) => {
      const url = stdout.trim();
      return url.startsWith("http") ? url : null;
    },
    cacheTtl: 30 * 24 * 60 * 60 * 1000, // 30 days (permanent host)
  },
];

function uploadWithProvider(provider, filePath) {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      provider.curlArgs(filePath),
      { timeout: 25000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        const url = provider.parseUrl(stdout);
        if (url) {
          resolve({ url, cacheTtl: provider.cacheTtl });
        } else {
          reject(new Error(`Unexpected response: ${stdout.trim().slice(0, 200)}`));
        }
      }
    );
  });
}

async function upload(imageKey, imageBuffer) {
  if (!imageKey || !imageBuffer) return null;

  const cached = cache.get(imageKey);
  if (cached) {
    log.debug(`Cache hit: ${imageKey}`);
    return cached;
  }

  const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
  const tmpFile = path.join(os.tmpdir(), `roon-cover-${Date.now()}.jpg`);

  try {
    fs.writeFileSync(tmpFile, buf);

    for (const provider of PROVIDERS) {
      try {
        log.info(`Uploading cover art via ${provider.name}: ${imageKey}`);
        const { url, cacheTtl } = await uploadWithProvider(provider, tmpFile);
        log.info(`Uploaded via ${provider.name}: ${url}`);
        cache.set(imageKey, url, cacheTtl);
        return url;
      } catch (err) {
        log.warn(`${provider.name} failed: ${err.message}`);
      }
    }

    log.error("All upload providers failed");
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

module.exports = { upload };
