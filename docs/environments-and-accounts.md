# Environments, roles, accounts and test data

Open **Environments & accounts** in Studio. A lead can define application roles, add environments, set each web/API address, create scoped accounts, choose defaults, configure a same-origin login form and edit environment test data. These are application test accounts, not SuperQ sign-in permissions or enterprise RBAC. The application remains responsible for enforcing real authorization; tests must assert allowed and denied behavior.

## Configuration

```json
{
  "roles": {"admin":{"description":"Administrator"},"customer":{"description":"Customer"}},
  "environments": {
    "qa": {
      "baseURL":"https://qa.example.com/",
      "apiURL":"https://api.qa.example.com/",
      "urls":{"inventory":"https://inventory.qa.example.com/"},
      "data":{"currency":"USD","quantity":2,"expectedTotal":120},
      "users":{
        "admin-primary":{"role":"admin","username":"qa-admin","passwordEnv":"QA_ADMIN_PASSWORD","tokenEnv":"QA_ADMIN_TOKEN"},
        "customer-primary":{"role":"customer","username":"qa-customer","passwordEnv":"QA_CUSTOMER_PASSWORD"}
      },
      "defaultUser":"customer-primary",
      "login":{"path":"login","usernameLabel":"Username","passwordLabel":"Password","submitButton":"Sign in","successPath":"dashboard"},
      "suiteData":{"regression":{"quantity":3}},
      "testData":{"TC-105":{"quantity":4}}
    },
    "uat": {
      "baseURL":"https://uat.example.com/",
      "apiURL":"https://api.uat.example.com/",
      "data":{"currency":"EUR","quantity":1,"expectedTotal":125},
      "users":{"customer-primary":{"role":"customer","username":"uat-customer","passwordEnv":"UAT_CUSTOMER_PASSWORD"}}
    }
  }
}
```

Merge this fragment into a project whose suites/test IDs match the overrides. Additional service URLs, suite overrides and case overrides currently use project configuration; Studio provides a table for environment data. Existing `baseURL`/`data` configurations remain valid. URLs must be HTTP(S) without embedded credentials. API paths resolve against `apiURL` (or `baseURL` when omitted); browser paths resolve against `baseURL`. An API step may explicitly select a configured `input.service` alias. There is no arbitrary cross-origin redirect following. Database adapter connection settings remain their existing process secret variables; HTTP service aliases are not database connection URLs.

## Account selection and authentication

A test may declare `role`, `user` (an environment account alias), or `anonymous: true`. Anonymous tests skip default accounts, bearer injection and configured form login. They cannot also require a role/account. Otherwise an explicit run account overrides the test account; the declared role must still match. Without an explicit account, role selection uses a matching default or exactly one matching environment account. Missing or ambiguous matches block the test. Without a role/account requirement, the environment default is used if present; otherwise the test runs anonymously. Accounts never fall back to another environment.

The simple Automate flow exposes application role at creation and environment/account at trial execution. The full Run dialog also supports account selection. For CLI runs/plans use `--user customer-primary`. Role-specific suites generally should let each test resolve its own account instead of overriding all tests with one user.

Secret **names** are saved; values are resolved from the server/CLI process only at execution. Define them through your shell or CI secret store and restart a running local server after changing its process environment. Missing configured secrets block the test. Selected account metadata is available as `${user.id}`, `${user.role}`, `${user.username}`, `${user.password}` and `${user.token}`; these namespaces cannot be overwritten by fixture data or response capture.

API requests automatically receive the selected account's bearer token for the configured API origin. Explicit step headers can override this for intentional authentication tests. A bearer token is not automatically forwarded to a different service origin; an explicit service-specific header is needed there. Browser form login uses the configured labels, account username/password and exact successful URL in a fresh session before the journey. No login is invented when configuration is absent. SSO/MFA, non-bearer API schemes, app-specific session provisioning and SuperQ platform authentication/RBAC remain separate work.

Resolved credentials are not written into the project or run results. Custom handlers receive runtime context and must preserve that boundary. Avoid hardcoding credentials in ordinary data, headers or URLs. Exported project definitions contain usernames and secret variable names, so treat them as configuration artifacts.

## Data resolution

Values use shallow overrides, in this order:

`project data < environment data < suite data < environment suite data < case data < environment case data`

Each attempt gets an isolated copy. Steps and assertions can use `${quantity}`, `${expectedTotal}` and `${currency}`; exact placeholders retain their JSON type. Locator values can use environment data too. Runtime URL values include `${url.web}`, `${url.api}` and `${url.inventory}` for configured service aliases. Required role selection is a declared test precondition, not a proof of the application's permissions.

Environment configuration changes invalidate report fingerprints, so old runs cannot establish current proof. Explicit run account selection is also bound into the fingerprint. This does not attest the externally deployed environment or secret contents; signed deployment/runtime identity and credential rotation history are not implemented.

[Environment setup preview](images/studio-environments.png)
