// Real biometric login via WebAuthn/passkeys (Face ID, fingerprint, Windows
// Hello, security keys — whatever the device's platform authenticator is).
// The server never sees or stores anything biometric: the phone/laptop does
// the actual face/fingerprint check locally and only hands us a
// cryptographic signature proving "yes, the same device that registered
// this credential approved this login."

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { nanoid } from 'nanoid';
import db from '../db/index.js';

// rpID must be the bare domain the app is served from (no scheme/port),
// e.g. "lscalpx.example.com". For local testing it's "localhost".
const RP_ID = process.env.WEBAUTHN_RP_ID || 'localhost';
const RP_NAME = 'L ScalpX Bot';
const ORIGIN = process.env.WEBAUTHN_ORIGIN || `https://${RP_ID}`;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const saveChallenge = db.prepare(`
  INSERT INTO webauthn_challenges (id, challenge, purpose, created_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET challenge=excluded.challenge, purpose=excluded.purpose, created_at=excluded.created_at
`);
const readChallenge = db.prepare('SELECT * FROM webauthn_challenges WHERE id = ?');
const deleteChallenge = db.prepare('DELETE FROM webauthn_challenges WHERE id = ?');

const insertCredential = db.prepare(`
  INSERT INTO webauthn_credentials (credential_id, user_id, public_key, counter, device_type, transports, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const findCredential = db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?');
const findCredentialsByUser = db.prepare('SELECT * FROM webauthn_credentials WHERE user_id = ?');
const bumpCounter = db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?');

function freshChallenge(id, purpose) {
  const row = readChallenge.get(id);
  if (!row) return null;
  if (Date.now() - row.created_at > CHALLENGE_TTL_MS) {
    deleteChallenge.run(id);
    return null;
  }
  if (row.purpose !== purpose) return null;
  return row.challenge;
}

// --- Registration (user is already logged in with password, adding a passkey) ---

export async function startRegistration(user) {
  const existing = findCredentialsByUser.all(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: Buffer.from(user.id),
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required', // forces the actual biometric/PIN check
      authenticatorAttachment: 'platform', // "platform" = Face ID/fingerprint/Windows Hello, not a USB key
    },
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: JSON.parse(c.transports || '[]') })),
  });
  saveChallenge.run(user.id, options.challenge, 'register', Date.now());
  return options;
}

export async function finishRegistration(user, response) {
  const expectedChallenge = freshChallenge(user.id, 'register');
  if (!expectedChallenge) throw new Error('Registration challenge expired — try again');

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Passkey registration could not be verified');
  }

  const { credential, credentialDeviceType } = verification.registrationInfo;
  insertCredential.run(
    credential.id,
    user.id,
    Buffer.from(credential.publicKey),
    credential.counter,
    credentialDeviceType,
    JSON.stringify(response.response?.transports || []),
    Date.now()
  );
  deleteChallenge.run(user.id);
  return true;
}

// --- Authentication (real login using Face ID / fingerprint, no password) ---

export async function startAuthentication() {
  const attemptId = nanoid();
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'required',
  });
  saveChallenge.run(attemptId, options.challenge, 'login', Date.now());
  return { attemptId, options };
}

export async function finishAuthentication(attemptId, response) {
  const expectedChallenge = freshChallenge(attemptId, 'login');
  if (!expectedChallenge) throw new Error('Login challenge expired — try again');

  const cred = findCredential.get(response.id);
  if (!cred) throw new Error('This passkey is not registered with any account');

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: cred.credential_id,
      publicKey: cred.public_key,
      counter: cred.counter,
    },
    requireUserVerification: true,
  });
  if (!verification.verified) throw new Error('Passkey login could not be verified');

  bumpCounter.run(verification.authenticationInfo.newCounter, cred.credential_id);
  deleteChallenge.run(attemptId);
  return cred.user_id;
}

export function userHasPasskey(userId) {
  return findCredentialsByUser.all(userId).length > 0;
}
