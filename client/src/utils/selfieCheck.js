/**
 * Selfie AI checks for OJT attendance.
 * - Blur detection: Laplacian variance on a downscaled grayscale image (no dependency).
 * - Face detection: native FaceDetector API when available (on-device AI, Chrome/Edge),
 *   with a lightweight heuristic fallback for browsers without it.
 *
 * Rejects blurred photos and photos with no detectable face.
 */

export const BLUR_THRESHOLD = 90;
const FACE_MIN_SKIN_RATIO = 0.04;

const loadImage = (dataUrl) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Unable to read that photo.'));
  img.src = dataUrl;
});

/** Downscale to small canvas and return grayscale pixels. */
const toGrayscale = (img, size = 160) => {
  const scale = Math.min(1, size / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const w = Math.max(8, Math.round((img.naturalWidth || img.width) * scale));
  const h = Math.max(8, Math.round((img.naturalHeight || img.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return { gray, w, h, raw: data };
};

/** Variance of the Laplacian — low values mean blurry / out of focus. */
export const laplacianBlurScore = (gray, w, h) => {
  const values = [];
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      values.push(lap);
    }
  }
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
};

const skinPixelRatio = (raw) => {
  let skin = 0;
  const total = raw.length / 4;
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i];
    const g = raw[i + 1];
    const b = raw[i + 2];
    // Basic skin-tone heuristic in YCrCb-ish range.
    if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) skin += 1;
  }
  return total ? skin / total : 0;
};

/** Native on-device face detection when the browser supports it. */
const detectFacesNative = async (img) => {
  if (!('FaceDetector' in window)) return null;
  try {
    const detector = new window.FaceDetector({ maxDetectedFaces: 3, fastMode: false });
    let source = img;
    if ('createImageBitmap' in window) {
      try { source = await createImageBitmap(img); } catch { source = img; }
    }
    const faces = await detector.detect(source);
    return { supported: true, count: faces?.length || 0 };
  } catch {
    return null;
  }
};

/**
 * Validate a selfie data URL.
 * Returns { ok, blurred, blurScore, faceCount, faceSupported, reason }.
 */
export const validateSelfie = async (dataUrl, { blurThreshold = BLUR_THRESHOLD } = {}) => {
  if (!dataUrl) return { ok: false, reason: 'No photo to check. Please retake your selfie.' };
  const img = await loadImage(dataUrl);
  if (!img.naturalWidth && !img.width) {
    return { ok: false, reason: 'That photo could not be read. Please retake it.' };
  }

  const { gray, w, h, raw } = toGrayscale(img);
  const blurScore = laplacianBlurScore(gray, w, h);
  const blurred = blurScore < blurThreshold;
  if (blurred) {
    return {
      ok: false,
      blurred: true,
      blurScore: Math.round(blurScore),
      reason: `Photo looks blurred (sharpness ${Math.round(blurScore)}). Hold still, face the light, and retake.`,
    };
  }

  const native = await detectFacesNative(img);
  if (native?.supported) {
    if (native.count < 1) {
      return {
        ok: false,
        blurred: false,
        blurScore: Math.round(blurScore),
        faceCount: 0,
        faceSupported: true,
        reason: 'No face detected. Center your face in the frame and retake.',
      };
    }
    return {
      ok: true,
      blurred: false,
      blurScore: Math.round(blurScore),
      faceCount: native.count,
      faceSupported: true,
    };
  }

  // Fallback for browsers without FaceDetector: brightness + skin-tone presence check.
  const ratio = skinPixelRatio(raw);
  const meanBrightness = gray.reduce((a, b) => a + b, 0) / gray.length;
  if (meanBrightness < 18 || meanBrightness > 245 || ratio < FACE_MIN_SKIN_RATIO) {
    return {
      ok: false,
      blurred: false,
      blurScore: Math.round(blurScore),
      faceCount: 0,
      faceSupported: false,
      reason: 'No face detected. Center your face in good lighting and retake (use Chrome for best detection).',
    };
  }
  return {
    ok: true,
    blurred: false,
    blurScore: Math.round(blurScore),
    faceCount: 1,
    faceSupported: false,
  };
};
