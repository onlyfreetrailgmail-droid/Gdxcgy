export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

// Sniff the real type from magic bytes; never trust the client MIME header or file name.
export const sniffImageType = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
};

export const validateImageUpload = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, code: 'EMPTY_FILE' };
  if (buf.length > MAX_UPLOAD_BYTES) return { ok: false, code: 'FILE_TOO_LARGE' };
  const type = sniffImageType(buf);
  if (!type) return { ok: false, code: 'UNSUPPORTED_TYPE' };
  return { ok: true, ...type };
};
