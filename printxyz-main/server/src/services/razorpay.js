import Razorpay from 'razorpay';
export const createRazorpay = (config) =>
  config.razorpay.keyId && config.razorpay.keySecret ? new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret }) : null;
