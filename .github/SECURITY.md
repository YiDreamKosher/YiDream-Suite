# Security

Report suspected vulnerabilities privately through the repository's Security tab if private vulnerability reporting is enabled. Otherwise contact the maintainer privately at yiddishdream@gmail.com. Do not post passwords, account tokens, user data or exploit details in public issues.

Before release, run the web build, JavaScript tests and database policy tests. Review dependency advisories, current GitHub Actions deprecations, workflow permissions, authentication and authorization. Confirm production migrations match the code. Never treat a successful build as proof that the application has no vulnerabilities.

Frontend Supabase publishable keys are public by design. Service-role keys, Gmail app passwords, OAuth secrets, signing keys and device tokens must remain private. Authorization is enforced in database policies and server functions, not only in the browser.
