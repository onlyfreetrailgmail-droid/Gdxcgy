import { OAuth2Client } from 'google-auth-library';
// Verifies the ID token signature, audience and expiry locally with Google's public keys.
export const createGoogleVerifier = (config) => {
  const client = new OAuth2Client(config.google.clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: config.google.clientId });
    const p = ticket.getPayload();
    return { email: p.email, emailVerified: p.email_verified === true, name: p.name, picture: p.picture };
  };
};
