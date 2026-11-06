# Administrator applications and email follow-up

The applicant signs in with Google or email, completes a three-step questionnaire and receives a pending application. Only the YiDream owner can approve or reject it. Existing administrator accounts keep their access. WhatsApp is optional; contact permission is recorded separately and no group membership is created.

Apply `migrations/20261105171307_administrator_applications_and_mail.sql` before deploying the new web interface. It is additive, preserves historical applications, and is safe to rerun. The previous `20261030000000_admin_access_control.sql` is also required for reversible administrator suspension.

The browser cannot provide an email recipient or decide that a message was sent. Database triggers queue receipt/decision messages addressed to the account's verified email. The Edge Function `application-mail` verifies the requesting user, claims only their application or an application accessible to the owner, and marks a message sent only after SMTP accepts it. SMTP acceptance is not a guarantee of inbox delivery. Retry leases and a maximum of five attempts prevent concurrent sends and repeated failures; an interrupted SMTP transaction can still result in a duplicate message.

## Enable the Gmail sender

Sender: `YiDream <yiddishdream@gmail.com>`, over Gmail SMTP with TLS on port 465. The service never uses the ordinary Gmail password.

1. On the sender's Google account, enable two-step verification and create an app password for “YiDream application emails”. Google may restrict this option for some account types. See https://support.google.com/accounts/answer/185833.
2. In Supabase Dashboard → Edge Functions → Secrets, add `GMAIL_APP_PASSWORD` with that app password. Enter it directly in the private dashboard; never put it in chat, Git, frontend variables or GitHub Actions logs.
3. Deploy `supabase/functions/application-mail/index.ts` as `application-mail`, using the checked-in function configuration. The handler verifies every user token with Supabase Auth (`getUser`) and reserves service-role invocations for the retry worker. The legacy gateway JWT verifier is disabled only to support current asymmetric signing keys; do not remove the handler authentication. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided privately by the runtime; do not copy them to the web client.
4. Submit an application using a controlled verified test account, then confirm receipt and each decision. Delete test records through the owner's normal process when finished.
5. Until the sender is configured, messages remain queued and the interface reports pending delivery rather than claiming success.

Submission and review immediately invoke the sender. For reliable retries even if the browser closes, configure a scheduled Supabase invocation of `application-mail` with body `{}` and the service-role JWT from Vault. Use Supabase's scheduled-function guide: https://supabase.com/docs/guides/functions/schedule-functions. The service-role credential stays in Vault, never in a repository. Start with a ten-minute interval. The worker processes at most five messages per invocation. The owner can also retry the current application from its review card; failed attempts are delayed ten minutes.

Do not enable an email Auth Hook for these messages: those hooks are for login/account emails, not application review.
