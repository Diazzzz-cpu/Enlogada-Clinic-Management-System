// Preparing a photo of an HMO card for upload.
//
// Lifted out of ClientDashboard.jsx unchanged. A self-contained browser routine — no React, no
// component state — and the booking dialog that calls it is itself being extracted, so leaving
// this behind would split one concern across two files.

// A phone photo of an HMO card is 3-8MB and slow to send on clinic-grade mobile data, and the
// booking is refused without it — so a failed upload is a failed booking. Downscaling in the
// browser turns it into a few hundred KB.
//
// It also sidesteps iPhone HEIC: the canvas re-encodes to JPEG, so whatever Safari can decode
// arrives in a format the clinic's staff browsers can open. Where a browser CANNOT decode the
// source (Chrome and Firefox have no HEIC decoder), this rejects with a message that says so
// rather than uploading something nobody can read.
const CARD_MAX_EDGE = 1600;   // a member number stays legible even when the card is a third of the frame
const CARD_JPEG_QUALITY = 0.82; // below ~0.7 the digit shapes start to mush, which is the failure that matters
const CARD_MAX_INPUT_BYTES = 25 * 1024 * 1024; // guards the decode step on low-end phones

// A doctor's request is a PAGE, often handwritten, where a card is a few printed digits. [1.106.0]
// 1600px across a whole A5 sheet blurs a signature and a scrawled test name, so it gets more.
const DOCUMENT_MAX_EDGE = 2400;

/**
 * @param {File} file
 * @param {object} [options]
 * @param {string} [options.name]     the uploaded file's name
 * @param {number} [options.maxEdge]  the longest side, in pixels
 */
async function prepareCardImage(file, { name = 'hmo-card.jpg', maxEdge = CARD_MAX_EDGE } = {}) {
  if (file.size > CARD_MAX_INPUT_BYTES) {
    throw new Error('That photo is too large for this device to process. Take a new photo with your camera instead.');
  }

  // PDFs are accepted by the server but cannot be drawn to a canvas, so they bypass the
  // downscale entirely — check them against the server's own ceiling here rather than letting
  // the whole upload complete before it is refused.
  if (file.type === 'application/pdf') {
    if (file.size > 8 * 1024 * 1024) {
      throw new Error('That PDF is larger than 8MB. Attach a photo instead, or a smaller scan.');
    }
    return file;
  }

  let bitmap;
  try {
    // from-image so a portrait phone photo is not uploaded sideways on engines that still
    // default to ignoring EXIF orientation.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      "This browser can't open that image format. If it came from an iPhone, take a new photo here instead, or save it as a JPG first."
    );
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const ctx = canvas.getContext('2d');
  // White first: a transparent PNG would otherwise become a black rectangle once encoded as JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', CARD_JPEG_QUALITY));
  // toBlob is specified to be able to hand back null under memory pressure. Silently ignoring
  // that would upload nothing and fail the booking with no explanation.
  if (!blob) throw new Error('We could not prepare that photo. Please take a new one.');

  return new File([blob], name, { type: 'image/jpeg' });
}

export { prepareCardImage, CARD_MAX_EDGE, DOCUMENT_MAX_EDGE, CARD_JPEG_QUALITY, CARD_MAX_INPUT_BYTES };
