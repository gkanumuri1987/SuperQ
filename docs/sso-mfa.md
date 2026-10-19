# Application SSO and MFA

These features authenticate test accounts in the application under test. They do not add SAML/OIDC sign-in, MFA enrollment or role-based access control to SuperQ itself.

## Easiest path: interactive sign-in, then reuse

1. Open **Environments & accounts** and choose an environment with test accounts.
2. Expand **SSO & interactive MFA** and enable session reuse. Configure the application's sign-in entry path, final signed-in path, and a visible confirmation. The confirmation can contain `${user.username}` to check an account-specific identity shown by the application.
3. Allowlist exact identity-provider and required resource origins, one per line. The application origin is included automatically. Wildcards, URL paths and arbitrary redirects are not accepted. An example origin is `https://identity.example.com`.
4. Save setup. Click **Sign in [account]** to open a fresh local Chromium window. Complete your provider's actual login and MFA challenge there.
5. Return to Studio and click **Save signed-in session**. SuperQ checks the configured final URL and visible text before saving application-applicable cookies and exact application-origin storage. Provider-origin-only state is omitted.
6. Run functional browser checks normally. Each journey restores its own isolated browser context and verifies the signed-in page before executing business steps. Server-side account/session state can still be shared; use independent accounts for conflicting parallel workflows. Missing/expired/rejected sessions produce a blocker. **Forget session** removes the current saved snapshot. It does not revoke provider-side tokens or sign out other devices.

Capture can use redirected or popup sign-in flows when the configured application success page is present in the same browser context. A local capture proxy checks HTTP requests and HTTPS CONNECT destinations against the configured origins, including redirect destinations; service workers are blocked. WebSocket upgrades over plain HTTP are not supported by the capture proxy. This is a targeted sign-in network control, not an isolated worker or general-purpose browser sandbox. During capture, configuration changes and test runs are blocked until the operator finishes or cancels. The capture window closes after ten minutes or when canceled. Browser closure is detected. There is no automatic MFA approval, CAPTCHA bypass or background re-authentication loop.

The signed-in marker and account binding must reflect the real application. A role label alone does not establish the provider's authenticated identity. Validate each provider/application configuration in a pilot; no live Entra ID, Okta, Auth0, SAML or enterprise policy validation has been performed. Provider-native push, SMS, security-key or passkey prompts remain human interactions and depend on the local browser/provider setup. Session reuse does not verify MFA on every test run.

## Headless runs and CI

Use the same project/environment/account and a protected auth directory:

```sh
npm run superq -- auth-login project.json qa customer-primary
npm run superq -- run project.json qa regression --user customer-primary
```

The CLI opens a local browser and waits for the operator to complete sign-in before confirming and saving. Studio and CLI default to `.superq/auth`; `SUPERQ_AUTH_DIR` selects a private directory, including a CI-provisioned directory. Snapshot names are hashes of the project name, environment, account, role, username, application address and SSO settings. Moving or changing that identity requires sign-in again. The default lifetime is 60 minutes, with a configurable maximum of 480; the application can invalidate a session sooner, which the execution probe detects.

Files contain live authentication material in JSON. They use owner-only file permissions on POSIX systems and are excluded by the default `.superq/` Git ignore. They are not encrypted or cryptographically attested, and Windows ACL provisioning remains the operator's responsibility. Treat them as credentials: do not commit, publish or include them in report uploads; restrict access, use temporary CI secrets storage and remove it after use. The repository's CI artifact upload selects `.superq/runs/`, not the auth directory. Reusing a session with a selected cloud browser sends its authentication state to that browser provider; apply your approved account/data policy.

Cookies, localStorage and IndexedDB use Playwright storage-state support. sessionStorage, arbitrary browser-profile data, provider policy/device binding and credential export portability are not guaranteed. A headless runner cannot refresh an expired interactive session by itself. Remote browser/session compatibility still requires validation. See [Playwright authentication](https://playwright.dev/docs/auth).

Session reuse applies to browser journeys. API steps continue to use configured bearer credentials or explicit headers; this change does not implement an OAuth token broker or automatically translate browser SSO into API tokens.

## Automated TOTP for configured test accounts

For applications using a two-stage labeled form login, enable **Use TOTP MFA** under **Browser login setup**. Set the code field label and verify button, then set each account's **TOTP secret name**. Keep the actual base32 seed in the process/CI secret store, alongside the existing password secret. SSO session reuse and form login are mutually exclusive environment modes.

```json
{
  "users": {
    "customer-primary": {
      "role": "customer",
      "username": "qa-customer",
      "passwordEnv": "QA_CUSTOMER_PASSWORD",
      "totpSecretEnv": "QA_CUSTOMER_TOTP"
    }
  },
  "login": {
    "path": "login",
    "usernameLabel": "Username",
    "passwordLabel": "Password",
    "submitButton": "Sign in",
    "successPath": "dashboard",
    "mfa": {
      "codeLabel": "Authentication code",
      "submitButton": "Verify",
      "digits": 6,
      "period": 30,
      "algorithm": "sha1"
    }
  }
}
```

Only variable names are persisted; seeds and generated codes are not added to project exports, runtime data or reports. The adapter waits for the MFA field before generating one current code. Authentication rejection blocks the test without an authentication retry loop. Business-step retries can start another fresh journey, so use session reuse for routine regression suites. Direct TOTP flows need dedicated accounts and a provider policy compatible with your sequencing; codes may be single-use, and sharing an account across concurrent logins is not coordinated by a distributed lease. CI clocks and provider settings must agree. Defaults are six digits, 30 seconds and SHA-1; eight digits, 60 seconds, SHA-256 and SHA-512 are configurable. This generates codes for pre-enrolled test accounts; it does not enroll a factor, obtain seeds from a user device, retrieve SMS/email messages or automate push/security-key approval. Use interactive sign-in for those provider-controlled factors.

The implementation is tested against [RFC 6238 vectors](https://www.rfc-editor.org/rfc/rfc6238), a controlled redirected provider/MFA fixture, actual local browser sessions, session rejection/expiry/isolation, TOTP form execution and the Studio capture/revoke workflow. These tests do not certify a production identity provider or the application's authorization rules.

[Studio SSO setup preview](images/studio-sso.png)
