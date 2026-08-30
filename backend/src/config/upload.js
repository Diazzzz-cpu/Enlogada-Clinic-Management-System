const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

// Feature Gap Plan Phase B: diagnostic result files.
//
// The storage key is built ONLY from server-generated material. It previously interpolated
// `req.params.visitTestId` and an extension taken from the uploader's own filename, both of which
// are attacker-controlled:
//
//   POST /api/results/..%2F..%2Fsrc%2Fscripts%2Fpwn   with filename="payload.js"
//
// Express 5 keeps %2F encoded while matching, so that whole string matches the single :visitTestId
// segment and is then decoded to `../../src/scripts/pwn`. multer's disk storage does a bare
// path.join(destination, filename) with no containment check, so the file lands outside the upload
// directory with an attacker-chosen extension. Worse, multer runs as route middleware, so the
// write happens BEFORE the controller's authorization check ever executes — the 403 that follows
// is too late, the file is already on disk.
//
// Two independent defences, because either alone would be enough and neither is expensive:
//   1. the name is random hex plus an extension mapped from the VALIDATED mime type, so no request
//      value reaches the path at all;
//   2. assertInside() re-checks the resolved path is under the upload root before accepting it.
//
// The uploader's original filename is still preserved in test_results.file_original_name, for
// display on download only — it is never used to build a path.
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'results');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// Extension is derived from the mime type we accepted, never from the client's filename.
const RESULT_MIME_EXTENSIONS = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * Refuses a storage key that would resolve outside its intended directory. The generated names
 * below cannot escape, so this never fires today — it is here so that a future change to the
 * naming scheme fails closed instead of silently reopening the traversal above.
 */
const assertInside = (root, name, cb) => {
  const resolved = path.resolve(root, name);
  if (resolved !== path.join(root, path.basename(name)) || !resolved.startsWith(path.resolve(root) + path.sep)) {
    return cb(new Error('Rejected upload: unsafe storage path.'));
  }
  return cb(null, name);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = RESULT_MIME_EXTENSIONS.get(file.mimetype) || '.bin';
    assertInside(UPLOAD_ROOT, `${crypto.randomBytes(16).toString('hex')}${ext}`, cb);
  }
});

const fileFilter = (req, file, cb) => {
  if (!RESULT_MIME_EXTENSIONS.has(file.mimetype)) {
    const error = new Error('Unsupported file type. Only PDF, JPEG, and PNG files are allowed.');
    error.statusCode = 400;
    return cb(error);
  }
  cb(null, true);
};

const uploadResultFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES }
});

// multer's own errors (wrong type, too large) carry no statusCode, so errorHandler.js would
// report them as a generic 500. But stamping everything 400 is wrong in the other direction:
// diskStorage propagates raw filesystem errors, so a server that has run out of disk told the
// user their file was bad. A MulterError is the caller's payload; anything else is ours.
const classifyUploadError = (err) => {
  if (err.statusCode) return err; // a fileFilter that already said what it meant
  if (err instanceof multer.MulterError) {
    err.statusCode = 400;
    // Only supply a generic message if the caller has not already written a better one.
    if (err.code === 'LIMIT_FILE_SIZE' && !err.friendlyMessage) err.message = 'That file is too large.';
    if (err.friendlyMessage) err.message = err.friendlyMessage;
  } else {
    err.statusCode = 500; // ENOSPC, EACCES, a broken stream — not something the patient can fix
  }
  return err;
};

const uploadResultFileMiddleware = (req, res, next) => {
  uploadResultFile.single('file')(req, res, (err) => {
    if (err) {
      return next(classifyUploadError(err));
    }
    next();
  });
};

// UI/UX Modernization Phase 8: profile avatars. This path was already safe — `req.user.userId` is
// a server-side integer read from the database by verifyToken, not a request value — but the
// extension still came from the uploader's filename, so it gets the same mime-mapped treatment
// and the same containment assertion as results above.
const AVATAR_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'avatars');
fs.mkdirSync(AVATAR_UPLOAD_ROOT, { recursive: true });

const AVATAR_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const MAX_AVATAR_SIZE_BYTES = 3 * 1024 * 1024; // 3MB

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = AVATAR_MIME_EXTENSIONS.get(file.mimetype) || '.bin';
    assertInside(AVATAR_UPLOAD_ROOT, `${req.user.userId}-${crypto.randomBytes(16).toString('hex')}${ext}`, cb);
  }
});

const avatarFileFilter = (req, file, cb) => {
  if (!AVATAR_MIME_EXTENSIONS.has(file.mimetype)) {
    const error = new Error('Unsupported file type. Only JPEG, PNG, and WebP images are allowed.');
    error.statusCode = 400;
    return cb(error);
  }
  cb(null, true);
};

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: avatarFileFilter,
  limits: { fileSize: MAX_AVATAR_SIZE_BYTES }
});

const uploadAvatarMiddleware = (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) {
      return next(classifyUploadError(err));
    }
    next();
  });
};

// [1.22.0] HMO card photos, attached while booking online. Same server-generated-filename
// pattern as the two above.
//
// The filename is seeded on the uploading user rather than the record it belongs to, because the
// hmo_requests row does not exist yet — it is created inside the booking transaction, long after
// multer has finished writing. Deliberately NOT seeded from a body field either: busboy emits
// parts in wire order, so req.body may still be empty when filename() runs, which would make the
// name depend on the order the browser happened to append fields in.
const HMO_CARD_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'hmo-cards');
fs.mkdirSync(HMO_CARD_UPLOAD_ROOT, { recursive: true });

// PDF is included because scanned cards arrive that way and reception will want to attach them.
// HEIC is excluded: staff browsers cannot render it, so accepting one would produce a claim with
// evidence nobody can look at.
//
// A Map rather than a Set for the same reason as the two above: the stored extension is derived
// from the mime type we validated, never from the uploader's filename.
const HMO_CARD_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);
// Larger than an avatar's 3MB, smaller than a result file's 15MB. A card photo does not need
// more, and this is a mandatory step in a booking — a false rejection here blocks the booking
// entirely, which is the one outcome worth sizing generously against. The client also downscales
// before sending, so this ceiling is a backstop rather than the normal case.
const MAX_HMO_CARD_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const hmoCardStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, HMO_CARD_UPLOAD_ROOT),
  filename: (req, file, cb) => {
    const ext = HMO_CARD_MIME_EXTENSIONS.get(file.mimetype) || '.bin';
    assertInside(HMO_CARD_UPLOAD_ROOT, `hmo-${req.user.userId}-${crypto.randomBytes(16).toString('hex')}${ext}`, cb);
  }
});

const hmoCardFileFilter = (req, file, cb) => {
  if (!HMO_CARD_MIME_EXTENSIONS.has(file.mimetype)) {
    const error = new Error('The HMO card must be a JPEG, PNG, WebP or PDF file.');
    error.statusCode = 400;
    return cb(error);
  }
  cb(null, true);
};

const uploadHmoCard = multer({
  storage: hmoCardStorage,
  fileFilter: hmoCardFileFilter,
  // files/fields bounds so a multipart body cannot be used to hold the connection open. The
  // booking body carries at most a handful of fields plus one testIds[] entry per test.
  limits: { fileSize: MAX_HMO_CARD_SIZE_BYTES, files: 1, fields: 40, fieldNameSize: 200 }
});

const uploadHmoCardMiddleware = (req, res, next) => {
  uploadHmoCard.single('hmoCard')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        err.friendlyMessage = 'The HMO card image must be 8MB or smaller.';
      }
      return next(classifyUploadError(err));
    }
    next();
  });
};

// Best-effort cleanup for a card whose booking did not commit. Callback form with an empty
// callback, never awaited: mirrors authService.uploadAvatar, and for the same reason — losing a
// stray file must never turn a rejected booking into a 500, nor mask the real error. multer
// removes its own partial writes when IT fails, so this only covers files it handed over
// successfully to a request that then went on to fail.
const discardHmoCard = (file) => {
  if (file && file.path) fs.unlink(file.path, () => {});
};

// [1.48.0] Two more image paths, both the same server-generated-filename pattern as everything
// above, and neither of them optional to get right.
//
//   payment-qr      the clinic's OWN GCash/bank QR, published to patients. SuperAdmin writes it.
//   payment-proof   a patient's screenshot of a transfer they say they made. The patient writes it.
//
// The second is the one to be careful with: it is an unauthenticated-user-shaped upload attached
// to a money claim, so it is size-bounded, mime-mapped and containment-checked exactly like the
// HMO card, and it is served back only through an ownership-checked route.
const PAYMENT_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'payments');
fs.mkdirSync(PAYMENT_UPLOAD_ROOT, { recursive: true });

// PDF is accepted for a proof — banks email PDF receipts and a patient will forward one — but NOT
// for the QR, which has to be an image the browser can render inline on the payment screen.
const PAYMENT_PROOF_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);
const PAYMENT_QR_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const MAX_PAYMENT_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB, matching the HMO card

const paymentUpload = (extensions, prefix, message) => {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, PAYMENT_UPLOAD_ROOT),
    filename: (req, file, cb) => {
      const ext = extensions.get(file.mimetype) || '.bin';
      // Seeded on the uploading user, not on the record: the submission row does not exist yet
      // when multer runs. Same reasoning as the HMO card above.
      assertInside(PAYMENT_UPLOAD_ROOT, `${prefix}-${req.user.userId}-${crypto.randomBytes(16).toString('hex')}${ext}`, cb);
    }
  });
  const fileFilter = (req, file, cb) => {
    if (!extensions.has(file.mimetype)) {
      const error = new Error(message);
      error.statusCode = 400;
      return cb(error);
    }
    cb(null, true);
  };
  return multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_PAYMENT_FILE_SIZE_BYTES, files: 1, fields: 30, fieldNameSize: 200 }
  });
};

const uploadPaymentProof = paymentUpload(
  PAYMENT_PROOF_MIME_EXTENSIONS, 'proof',
  'The proof of payment must be a JPEG, PNG, WebP or PDF file.'
);
const uploadPaymentQr = paymentUpload(
  PAYMENT_QR_MIME_EXTENSIONS, 'qr',
  'The QR image must be a JPEG, PNG or WebP file.'
);

const paymentUploadMiddleware = (upload, field, sizeMessage) => (req, res, next) => {
  upload.single(field)(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        err.friendlyMessage = sizeMessage;
      }
      return next(classifyUploadError(err));
    }
    next();
  });
};

const uploadPaymentProofMiddleware = paymentUploadMiddleware(
  uploadPaymentProof, 'proof', 'The proof of payment must be 8MB or smaller.'
);
const uploadPaymentQrMiddleware = paymentUploadMiddleware(
  uploadPaymentQr, 'qr', 'The QR image must be 8MB or smaller.'
);

/** Best-effort cleanup, same contract and same reasoning as discardHmoCard. */
const discardPaymentFile = (file) => {
  if (file && file.path) fs.unlink(file.path, () => {});
};

/**
 * The receipt-scan upload, which deliberately writes NOTHING to disk. [1.62.0]
 *
 * Every other upload path here persists, because every other upload is evidence somebody will
 * need to look at later. A scan is not evidence: it is a throwaway pass over an image purely to
 * suggest what the patient should type, and the SAME image is uploaded again moments later by the
 * real submit endpoint, which does store it.
 *
 * `memoryStorage` therefore, and the reasoning matters more than the mechanism. Disk storage
 * would create an orphan for every scan — including every scan the user then abandoned, which is
 * most of them, since the whole point is that they scan before deciding to submit. Those files
 * would accumulate under uploads/payments/ mixed in with real proofs, indistinguishable from
 * them, with nothing that could ever safely delete them. An upload with no reader does not need
 * a retention policy; it needs to not exist.
 *
 * PDF is accepted for a stored proof but NOT here: Tesseract reads raster images, and handing it
 * a PDF produces an empty result that reads to the user as "your receipt is unreadable" rather
 * than "this format cannot be scanned". Refusing it with a clear message is the honest answer.
 *
 * The size ceiling is lower than the 8MB a stored proof allows, because this buffer is held in
 * process memory and then handed to an OCR engine — the constraint here is the server's RAM, not
 * the patient's camera.
 */
const RECEIPT_SCAN_MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const MAX_RECEIPT_SCAN_SIZE_BYTES = 6 * 1024 * 1024; // 6MB

const uploadReceiptScan = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!RECEIPT_SCAN_MIME_EXTENSIONS.has(file.mimetype)) {
      const error = new Error('Only a JPEG, PNG or WebP image can be scanned. A PDF receipt can still be uploaded — type the details in yourself.');
      error.statusCode = 400;
      return cb(error);
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_RECEIPT_SCAN_SIZE_BYTES, files: 1, fields: 10, fieldNameSize: 200 }
});

const uploadReceiptScanMiddleware = (req, res, next) => {
  uploadReceiptScan.single('proof')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        err.friendlyMessage = 'The image must be 6MB or smaller to be scanned.';
      }
      return next(classifyUploadError(err));
    }
    next();
  });
};

module.exports = {
  uploadResultFileMiddleware,
  UPLOAD_ROOT,
  uploadReceiptScanMiddleware,
  uploadAvatarMiddleware,
  AVATAR_UPLOAD_ROOT,
  uploadHmoCardMiddleware,
  HMO_CARD_UPLOAD_ROOT,
  discardHmoCard,
  uploadPaymentProofMiddleware,
  uploadPaymentQrMiddleware,
  PAYMENT_UPLOAD_ROOT,
  discardPaymentFile
};
