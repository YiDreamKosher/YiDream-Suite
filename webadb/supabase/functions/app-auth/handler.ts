import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import nodemailer from 'npm:nodemailer@10.3.1';

const allowedOrigins = new Set(['https://yidreamkosher.github.io']);
// This key is intentionally public and identifies the project, not an authenticated user.
// Older hosted runtimes may not provide the named-key map yet.
const legacyRuntimePublishableKey = 'sb_publishable_YG9zgjQ5Y56WiBtKdJMQvA_-UBAFv9B';
function acceptsProjectKey(key: string | null) {
  if (!key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return false;
  const configuredKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (configuredKeys === undefined) return key === legacyRuntimePublishableKey;
  try {
    const keys = JSON.parse(configuredKeys);
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return false;
    return Object.values(keys).some(value => typeof value === 'string' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(value) && value === key);
  } catch { return false; }
}
const acknowledgment = { ok: true, message: 'If delivery is available, a sign-in code will arrive by email. Please wait before trying again.' };
const json = (body: unknown, status = 200, origin = '') => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store',
    ...(allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  },
});

// Hash with a private HMAC key so a leaked budget identifier cannot be dictionary-matched
// against public email addresses. No recipient, IP, OTP or access token is logged.
async function identifierHash(secret: string, kind: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${kind}:${value}`));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** The peer is supplied by Deno's connection info, never a client-controlled forwarded header. */
export async function handler(req: Request, peerAddress: string | null = null) {
  const origin = req.headers.get('origin') || '';
  if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin refused' }, 403);
  if (req.method === 'OPTIONS') return new Response(null, { headers: {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://yidreamkosher.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST',
  } });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (!acceptsProjectKey(req.headers.get('apikey'))) return json({ error: 'Project API key required' }, 401, origin);

  let email: string;
  try {
    if (Number(req.headers.get('content-length') || 0) > 1024) return json({ error: 'Invalid request' }, 400, origin);
    const raw = await req.text();
    if (raw.length > 1024) return json({ error: 'Invalid request' }, 400, origin);
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.email !== 'string') return json({ error: 'Invalid email address' }, 400, origin);
    email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[^\x21-\x7e]/.test(email)) return json({ error: 'Invalid email address' }, 400, origin);
  } catch { return json({ error: 'Invalid request' }, 400, origin); }

  const serviceUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const mailPassword = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!serviceUrl || !serviceKey || !mailPassword) return json({ error: 'Sign-in email is temporarily unavailable' }, 503, origin);

  try {
    const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    // Hosted proxies may expose only a shared peer. That deliberately shares a conservative
    // bucket rather than trusting X-Forwarded-For, CF-Connecting-IP or any public request header.
    const peer = peerAddress && peerAddress.length <= 128 ? peerAddress : 'shared-ingress';
    const [emailHash, ipHash] = await Promise.all([
      identifierHash(serviceKey, 'email', email), identifierHash(serviceKey, 'peer', peer),
    ]);
    const claim = await admin.rpc('yd_claim_app_auth_email', { email_hash: emailHash, ip_hash: ipHash });
    if (claim.error) return json({ error: 'Sign-in email is temporarily unavailable' }, 503, origin);
    if (claim.data !== true) return json(acknowledgment, 202, origin);

    // generateLink does not send an email. The private sender delivers the OTP, and Auth
    // verifies it with POST /auth/v1/verify {email, token, type:"email"} in the Android app.
    const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const code = generated.data?.properties?.email_otp;
    if (generated.error || typeof code !== 'string' || !/^\d{6,8}$/.test(code)) return json(acknowledgment, 202, origin);

    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: 'yiddishdream@gmail.com', pass: mailPassword },
      connectionTimeout: 10000, socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true,
    });
    try {
      await transport.sendMail({
        from: 'YiDream <yiddishdream@gmail.com>', to: email,
        subject: 'Your YiDream sign-in code',
        text: `Your YiDream sign-in code is: ${code}\n\nEnter this code only in the YiDream app. It can be used once and expires according to the project's authentication settings.\n\nIf you did not request this code, ignore this message. Never share it with anyone, including someone claiming to be YiDream support.\n\nYiDream`,
      });
    } finally { transport.close(); }
  } catch {
    // Account existence, disabled status and delivery errors have the same public response.
    // The reserved budget remains consumed even when a provider fails.
  }
  return json(acknowledgment, 202, origin);
}
