import { v2 as cloudinary } from 'cloudinary';

// Customer photos are stored with type "private": no public URL exists. Access is via short-lived signed URLs.
export const createCloudinary = (config) => {
  const configured = Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);
  if (configured) cloudinary.config({ cloud_name: config.cloudinary.cloudName, api_key: config.cloudinary.apiKey, api_secret: config.cloudinary.apiSecret, secure: true });
  return {
    configured,
    uploadPrivate: (buffer, { folder = 'printxyz/customer-photos', ext = 'jpg' } = {}) => new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder, type: 'private', resource_type: 'image', format: ext, overwrite: false, unique_filename: true }, (err, r) => (err ? reject(err) : resolve({ publicId: r.public_id, format: r.format, bytes: r.bytes })))
        .end(buffer);
    }),
    // Public images (review photos, banners). Delivered through Cloudinary's CDN with automatic format (WebP/AVIF) and quality.
    uploadPublic: (buffer, { folder = 'printxyz/review-photos', ext = 'jpg' } = {}) => new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream({ folder, type: 'upload', resource_type: 'image', format: ext, overwrite: false, unique_filename: true }, (err, r) => (err ? reject(err) : resolve({ publicId: r.public_id, format: r.format, bytes: r.bytes, url: r.secure_url })))
        .end(buffer);
    }),
    publicUrl: (publicId, { width = 900 } = {}) => cloudinary.url(publicId, { secure: true, fetch_format: 'auto', quality: 'auto', width, crop: 'limit' }),
    destroyPublic: (publicId) => cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'upload', invalidate: true }),
    destroy: (publicId) => cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'private', invalidate: true }),
    signedUrl: (publicId, format = 'jpg', ttlSeconds = 900) =>
      cloudinary.utils.private_download_url(publicId, format, { resource_type: 'image', type: 'private', expires_at: Math.floor(Date.now() / 1000) + ttlSeconds })
  };
};
