const { Blob } = require("buffer");
const constants = require("./constants");
const cache = require("./cache");
const { createLogger } = require("./logger");

const log = createLogger("Images");

const CATBOX_URL = "https://catbox.moe/user/api.php";

async function upload(imageKey, imageBuffer) {
  if (!imageKey || !imageBuffer) return null;

  const cached = cache.get(imageKey);
  if (cached) {
    log.debug(`Cache hit: ${imageKey}`);
    return cached;
  }

  try {
    log.info(`Uploading cover art: ${imageKey}`);

    const buf = Buffer.isBuffer(imageBuffer) ? imageBuffer : Buffer.from(imageBuffer);
    const blob = new Blob([buf], { type: constants.imageFormat });

    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", blob, "cover.jpg");

    const response = await fetch(CATBOX_URL, {
      method: "POST",
      body: form,
    });

    const text = (await response.text()).trim();

    if (!response.ok) {
      log.error(`Catbox HTTP ${response.status}: ${text}`);
      return null;
    }

    if (!text.startsWith("http")) {
      log.error("Catbox unexpected response:", text);
      return null;
    }

    log.info(`Uploaded: ${text}`);
    // Catbox is permanent, use long TTL cache (30 days)
    cache.set(imageKey, text, 30 * 24 * 60 * 60 * 1000);
    return text;
  } catch (err) {
    log.error("Failed to upload image:", err.message, err.cause || "");
    return null;
  }
}

module.exports = { upload };
