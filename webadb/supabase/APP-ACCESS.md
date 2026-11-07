# End-user app accounts

The Android user interface now requires an end-user account or a valid code issued by an approved YiDream administrator. These accounts are separate from `platform_admins`. Signing in to the app never grants access to the administration website, device-owner privileges or another customer's devices.

## Sign-in methods

**Email and contact number:** the app asks for an email address and an international phone number. `app-auth` privately generates a Supabase Auth email OTP and sends it from `YiDream <yiddishdream@gmail.com>`. The app verifies the OTP directly with Supabase Auth, then calls `yd_complete_app_profile`. The server reads the confirmed address from `auth.users`; it never trusts an email supplied in profile metadata. The phone number is a contact field, not SMS-verified identity. JWT expiry/refresh and OTP verification remain managed by Supabase Auth.

**Administrator code:** the administrator chooses a physically configured device in the existing pairing panel and issues a random 128-bit, 32-character hexadecimal code. The code expires after 15 minutes and can be redeemed once. The app asks for an email and phone contact, then calls `yd_activate_app_code`. The server creates a separate, unverified-contact account and a session scoped to that device for 30 days. Typing the email of a verified account never merges or changes that account. After expiry or logout, a fresh code or email sign-in plus re-pairing is required. Reissuing a code alone leaves the current phone session in place; redemption rotates the tokens. Device and app-session credentials use independent 256-bit random values; only SHA-256 hashes remain on the server.

WhatsApp support is available from the sign-in screen at `https://wa.me/33766790352`. Opening the link starts the user's own WhatsApp/browser flow; YiDream does not automatically send a message, join a group or verify the contact number.

## Backend contracts

All RPC calls and the `app-auth` request use the project's public publishable API key in the `apikey` header. `app-auth` checks that key against valid `sb_publishable_…` entries in the runtime's `SUPABASE_PUBLISHABLE_KEYS` JSON map. If the map is absent on an older runtime, it accepts only the project's existing checked-in public key; a malformed or empty configured map fails closed. Missing, wrong, legacy JWT and private keys are rejected with HTTP 401 before any budget/Auth/mail work. This identifies public project API traffic; the key is distributed in the app and is **not a secret, user authentication, proof of the genuine app, or an abuse defense**. The transactional quotas below remain mandatory. Never put the service-role key or Gmail password in the APK or website.

| Endpoint | Caller | Result |
| --- | --- | --- |
| `POST /functions/v1/app-auth` with `{email}` | Public app | Generic HTTP 202 acknowledgment after a valid request. No OTP, account existence or delivery details are returned. Invalid input returns 400; globally missing private configuration returns 503. |
| `POST /auth/v1/verify` with `{email,token,type:"email"}` | Public app | Supabase Auth access/refresh tokens after OTP verification. |
| `yd_complete_app_profile(contact_phone text)` | Confirmed email bearer | `{account,device_id,expires_at:null}`. Contact number must be E.164, `+` followed by 8–15 digits. |
| `yd_app_access_status(app_token text default null)` | Email bearer, or code-session token | `{account,device_id,expires_at}`; code-session expiry is an ISO timestamp. Invalid or suspended access raises `APP_ACCESS_DENIED`. |
| `yd_create_pairing(target_device uuid)` | Approved admin in own device scope; owner across devices | 32-character uppercase hex code, 15-minute lifetime. Device must have `configuration_status='configured'`. |
| `yd_activate_app_code(account_code,contact_email,contact_phone)` | Public app holding the code | `{account,device_id,token,app_token,expires_at}`. Both tokens are opaque 64-character hex strings and are returned only at redemption. |
| `yd_pair_device(pairing_code text)` | Confirmed email account bearer | `{account,device_id,token}`. Anonymous legacy pairing is no longer permitted. |
| `yd_logout_app_session(app_token text)` | Holder of code-session token | Idempotent void. Revokes that session, without changing filtering or suspending the account globally. |
| `yd_list_app_accounts()` | Approved admin or owner | Device-scoped rows with `id,email,contact_phone,email_verified,is_active,device_id,device_name,created_at,last_seen_at,can_manage`. |
| `yd_set_app_account_access(target_account uuid,enabled boolean)` | Owner, or approved admin owning every linked device of that account | Void. Ordinary shop admins cannot globally suspend shared accounts spanning other shops. |

`account` contains `id,email,contact_phone,email_verified,is_active`. A verified email account may enter the app before a device is associated; cloud catalog and website-request features still require a configured, enrolled device. An administrator-issued code authenticates only its one enrolled device.

Every catalog/request call continues to include `device_token`, plus either the signed-in user's `Authorization: Bearer …` or the `x-yidream-app-token` header. Private APK downloads require the same app identity and `x-yidream-device-token`. Backend RPCs and storage policies validate active account, matching device binding, configured device and active approved issuer. A cached local token alone is insufficient. Changed shop ownership invalidates the old issuer's device access.

Suspension takes effect on the next protected operation/status check. Restoring an account may restore a still-valid existing session; logout and 30-day expiry require a fresh sign-in/code. Confirmed-email operations also verify the JWT's `session_id` against the current `auth.sessions` record and its `not_after` value, so a removed/expired Auth session cannot keep using cloud APIs until JWT expiry. Suspending an account also invalidates any unredeemed codes for its devices. Code creation/redemption and suspension serialize through a transaction lock so old-code redemption cannot race a suspension. Device policy/filtering remains installed while signed out or offline.

## Email delivery protection

`app-auth` is public because it starts authentication, but it reserves a service-only database budget **before** generating an OTP or sending SMTP:

- 60-second cooldown and at most five allowed messages per email in a daily window.
- At most 15 allowed messages per connection peer in an hourly window.
- At most 100 allowed messages globally in a daily window.

All quota decisions are serialized transactionally. Failed generation/delivery still consumes the reservation. Email and peer identifiers are HMAC-SHA-256 values keyed with the private runtime service key. Raw email addresses, connection peers, OTPs and tokens are not logged or stored in the budget table. Records older than two days are cleaned during reservation. A service-key rotation changes the per-email/peer hashes; the global budget remains binding.

The function ignores `X-Forwarded-For`, `CF-Connecting-IP` and other client-supplied headers. It uses Deno connection information when available, otherwise a shared ingress bucket. A hosted gateway may share one peer for all users, making the hourly limit deliberately conservative. Do not replace this with an arbitrary forwarded header without a documented trusted-ingress contract. This is a bounded initial mail service, not a bulk email sender; larger demand needs a reviewed quota/provider change.

## Deployment order

1. Build and test the Android account gate and prepare the matching APK before enabling this migration. Old installed APKs lack app-session headers, so their cloud catalog/requests/APK downloads will be denied after the migration; their installed device filtering policy is not removed.
2. Apply `20261106135728_app_customer_access.sql` after the existing active-admin and MDM migrations. It preserves device configuration, catalog, requests and old records, and is safe to re-run. Existing enrollment tokens do not silently become authenticated app sessions.
3. Deploy `supabase/functions/app-auth/index.ts` as `app-auth` with the checked-in `verify_jwt=false` configuration. The endpoint validates the public project key in its handler, then generates and mails codes only after its private budget check. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and normally `SUPABASE_PUBLISHABLE_KEYS` are supplied by the runtime; reuse the existing private `GMAIL_APP_PASSWORD` secret. No global Auth SMTP setting is changed. The distinction between publishable-key identification and user authentication follows [Supabase's Edge Function auth modes](https://supabase.com/docs/guides/functions/auth).
4. Deploy the admin pairing/account controls and distribute the APK update. Issue fresh codes from eligible configured devices or use email sign-in and then pair.
5. Test one approved administrator, one controlled customer address and one configured device. Confirm email OTP single use, both sign-in routes, logout, suspension/restoration, cross-shop denial and private APK access. Do not publish OTPs, token responses, Gmail passwords or personal contact lists in build logs or screenshots.

Automated SQL tests cover account separation, RLS, phone/email validation, single-use/expired codes, device/storage authorization, issuer suspension/ownership changes, account suspension/restoration, logout and the private mail budget. Edge tests replace Auth/SMTP with fakes and verify the budget order, generic responses and forwarded-header spoof resistance. These checks do not prove inbox placement or a physical Android device's behavior.
