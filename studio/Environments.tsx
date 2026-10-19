import { useState } from "react";
import type { Project } from "../src/model";
import { Environment } from "../src/environment";
import "./environments.css";
type Row = { key: string; value: string };
export default function Environments({
  project: p,
  save,
  authSessions = {},
  signIn = null,
  action,
}: {
  project: Project;
  authSessions?: Record<string, Record<string, string>>;
  signIn?: { id: string; environment: string; user: string } | null;
  action?: (path: string, body: Record<string, unknown>) => Promise<boolean>;
  save: (value: Record<string, unknown>) => Promise<boolean>;
}) {
  const [base, setBase] = useState(() => ({
    roles: p.roles ?? {},
    environments: p.environments,
  }));
  const [envs, setEnvs] = useState(() => structuredClone(p.environments)),
    [roles, setRoles] = useState(() => structuredClone(p.roles ?? {})),
    [selected, setSelected] = useState(Object.keys(p.environments)[0] ?? ""),
    [newEnv, setNewEnv] = useState(""),
    [newRole, setNewRole] = useState(""),
    [newUser, setNewUser] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Record<string, Row[]>>(() =>
    Object.fromEntries(
      Object.entries(p.environments).map(([k, e]) => [
        k,
        Object.entries(e.data).map(([key, value]) => ({
          key,
          value: JSON.stringify(value),
        })),
      ]),
    ),
  );
  const env = envs[selected];
  const update = (patch: Partial<Environment>) =>
    setEnvs({ ...envs, [selected]: { ...env!, ...patch } });
  const updateUser = (id: string, patch: Record<string, unknown>) =>
    update({
      users: { ...env!.users, [id]: { ...env!.users![id]!, ...patch } },
    });
  function name(value: string) {
    if (!/^[A-Za-z][\w-]*$/.test(value))
      throw new Error(
        "Use a name starting with a letter; letters, numbers, dashes and underscores are allowed.",
      );
    return value;
  }
  async function persist() {
    setError("");
    try {
      const next = structuredClone(envs);
      for (const [id, list] of Object.entries(rows)) {
        const keys = list.map((r) => r.key.trim());
        if (keys.some((k) => !k) || new Set(keys).size !== keys.length)
          throw new Error(`Test data in ${id} needs unique, non-empty names.`);
        next[id]!.data = Object.fromEntries(
          list.map((r) => {
            let value: unknown = r.value;
            try {
              value = JSON.parse(r.value);
            } catch {}
            return [r.key.trim(), value];
          }),
        );
      }
      for (const [id, value] of Object.entries(next)) {
        const parsed = Environment.safeParse(value);
        if (!parsed.success) {
          const path = parsed.error.issues[0]?.path.join(" / ") ?? "settings";
          throw new Error(`${id}: check ${path} before saving.`);
        }
      }
      setBusy(true);
      if (await save({ base, roles, environments: next })) {
        setBase({ roles, environments: next });
        setEnvs(next);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="environment-settings">
      <h1>Environments & test accounts</h1>
      <p>
        Set this up once. Functional tests can reuse the right URL, role and
        data in each environment.
      </p>
      <details className="environment-card">
        <summary>Application roles ({Object.keys(roles).length})</summary>
        {Object.entries(roles).map(([id, r]) => (
          <div className="environment-row" key={id}>
            <strong>{id}</strong>
            <label>
              Description for {id}
              <input
                value={r.description}
                onChange={(e) =>
                  setRoles({ ...roles, [id]: { description: e.target.value } })
                }
              />
            </label>
            <button
              className="button"
              onClick={() => {
                const copy = { ...roles };
                delete copy[id];
                setRoles(copy);
              }}
            >
              Remove role {id}
            </button>
          </div>
        ))}
        <div className="environment-row">
          <label>
            New role name
            <input
              value={newRole}
              placeholder="admin or customer"
              onChange={(e) => setNewRole(e.target.value)}
            />
          </label>
          <button
            className="button"
            onClick={() => {
              try {
                const id = name(newRole);
                if (Object.hasOwn(roles, id))
                  throw new Error("That role already exists.");
                setRoles({ ...roles, [id]: { description: "" } });
                setNewRole("");
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Add role
          </button>
        </div>
      </details>
      <div className="environment-row">
        <label>
          Environment
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setNewUser("");
            }}
          >
            {Object.keys(envs).map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label>
          New environment name
          <input
            value={newEnv}
            placeholder="qa or uat"
            onChange={(e) => setNewEnv(e.target.value)}
          />
        </label>
        <button
          className="button"
          onClick={() => {
            try {
              const id = name(newEnv);
              if (Object.hasOwn(envs, id))
                throw new Error("That environment already exists.");
              setEnvs({
                ...envs,
                [id]: { baseURL: "https://example.invalid/", data: {} },
              });
              setRows({ ...rows, [id]: [] });
              setSelected(id);
              setNewEnv("");
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Add environment
        </button>
      </div>
      {env && (
        <>
          <div className="environment-card">
            <h2>Application addresses</h2>
            <label>
              Web application URL
              <input
                value={env.baseURL}
                onChange={(e) => update({ baseURL: e.target.value })}
              />
            </label>
            <label>
              API base URL (optional)
              <input
                value={env.apiURL ?? ""}
                onChange={(e) =>
                  update({ apiURL: e.target.value || undefined })
                }
              />
            </label>
            <p>
              Use full HTTP(S) addresses. If the API URL is blank, API tests use
              the web address.
            </p>
          </div>
          <div className="environment-card">
            <h2>Test accounts for {selected}</h2>
            <p>
              Accounts represent users of the application under test. Role names
              describe test intent; your application still enforces actual
              permissions.
            </p>
            {Object.entries(env.users ?? {}).map(([id, u]) => (
              <fieldset key={id}>
                <legend>{id}</legend>
                <div className="environment-row">
                  <label>
                    Role for {id}
                    <select
                      value={u.role}
                      onChange={(e) => updateUser(id, { role: e.target.value })}
                    >
                      <option value="">Choose role…</option>
                      {Object.keys(roles).map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Username for {id}
                    <input
                      value={u.username ?? ""}
                      autoComplete="off"
                      onChange={(e) =>
                        updateUser(id, {
                          username: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="environment-row">
                  <label>
                    Password secret name for {id}
                    <input
                      value={u.passwordEnv ?? ""}
                      placeholder={`${selected.toUpperCase()}_${u.role.toUpperCase()}_PASSWORD`}
                      autoComplete="off"
                      onChange={(e) =>
                        updateUser(id, {
                          passwordEnv: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                  <label>
                    API token secret name for {id}
                    <input
                      value={u.tokenEnv ?? ""}
                      placeholder={`${selected.toUpperCase()}_${u.role.toUpperCase()}_TOKEN`}
                      autoComplete="off"
                      onChange={(e) =>
                        updateUser(id, {
                          tokenEnv: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                </div>
                {env.login?.mfa && (
                  <label>
                    TOTP secret name for {id}
                    <input
                      value={u.totpSecretEnv ?? ""}
                      placeholder={`${selected.toUpperCase()}_${u.role.toUpperCase()}_TOTP`}
                      autoComplete="off"
                      onChange={(e) =>
                        updateUser(id, {
                          totpSecretEnv: e.target.value || undefined,
                        })
                      }
                    />
                  </label>
                )}
                <button
                  className="button"
                  onClick={() => {
                    const users = { ...env.users };
                    delete users[id];
                    update({
                      users,
                      defaultUser:
                        env.defaultUser === id ? undefined : env.defaultUser,
                    });
                  }}
                >
                  Remove account {id}
                </button>
              </fieldset>
            ))}
            <div className="environment-row">
              <label>
                New account name
                <input
                  value={newUser}
                  placeholder="admin-primary"
                  onChange={(e) => setNewUser(e.target.value)}
                />
              </label>
              <button
                className="button"
                onClick={() => {
                  try {
                    const id = name(newUser);
                    if (Object.hasOwn(env.users ?? {}, id))
                      throw new Error("That account already exists.");
                    const role = Object.keys(roles)[0];
                    if (!role)
                      throw new Error("Add an application role first.");
                    update({ users: { ...env.users, [id]: { role } } });
                    setNewUser("");
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Add account
              </button>
            </div>
            <label>
              Default account for {selected}
              <select
                value={env.defaultUser ?? ""}
                onChange={(e) =>
                  update({ defaultUser: e.target.value || undefined })
                }
              >
                <option value="">No default account</option>
                {Object.entries(env.users ?? {}).map(([id, u]) => (
                  <option key={id} value={id}>
                    {id} ({u.role})
                  </option>
                ))}
              </select>
            </label>
            <p>
              Enter secret variable names here, not passwords or tokens. Set
              their values in the SuperQ process or CI secret store before
              running tests.
            </p>
          </div>
          <div className="environment-card">
            <h2>Test data for {selected}</h2>
            <p>
              Reuse values in steps and expected results with{" "}
              <code>{"${name}"}</code>. Numbers, booleans and JSON remain typed;
              ordinary text stays a string.
            </p>
            {(rows[selected] ?? []).map((r, i) => (
              <div className="environment-row" key={i}>
                <label>
                  Data name {i + 1}
                  <input
                    value={r.key}
                    onChange={(e) =>
                      setRows({
                        ...rows,
                        [selected]: rows[selected]!.map((v, j) =>
                          i === j ? { ...v, key: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Data value {i + 1}
                  <input
                    value={r.value}
                    onChange={(e) =>
                      setRows({
                        ...rows,
                        [selected]: rows[selected]!.map((v, j) =>
                          i === j ? { ...v, value: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className="button"
                  aria-label={`Remove data ${i + 1}`}
                  onClick={() =>
                    setRows({
                      ...rows,
                      [selected]: rows[selected]!.filter((_, j) => i !== j),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="button"
              onClick={() =>
                setRows({
                  ...rows,
                  [selected]: [
                    ...(rows[selected] ?? []),
                    { key: "", value: "" },
                  ],
                })
              }
            >
              Add test data
            </button>
          </div>
          <details className="environment-card">
            <summary>SSO & interactive MFA</summary>
            <label>
              <input
                type="checkbox"
                checked={!!env.sso}
                onChange={(e) =>
                  update({
                    login: undefined,
                    sso: e.target.checked
                      ? {
                          startPath: "login",
                          successPath: "",
                          successText: "",
                          allowedOrigins: [],
                          maxAgeMinutes: 60,
                        }
                      : undefined,
                  })
                }
              />
              Reuse an SSO/MFA-authenticated browser session
            </label>
            {env.sso && (
              <>
                <label>
                  SSO start page path
                  <input
                    value={env.sso.startPath}
                    onChange={(e) =>
                      update({
                        sso: { ...env.sso!, startPath: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Signed-in page path
                  <input
                    value={env.sso.successPath}
                    onChange={(e) =>
                      update({
                        sso: { ...env.sso!, successPath: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Signed-in confirmation text
                  <input
                    value={env.sso.successText}
                    placeholder="Welcome ${user.username}"
                    onChange={(e) =>
                      update({
                        sso: { ...env.sso!, successText: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Allowed identity-provider origins (one per line)
                  <textarea
                    key={selected}
                    rows={3}
                    defaultValue={env.sso.allowedOrigins.join("\n")}
                    placeholder="https://login.example.com"
                    onBlur={(e) =>
                      update({
                        sso: {
                          ...env.sso!,
                          allowedOrigins: e.target.value
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Session lifetime in minutes
                  <input
                    type="number"
                    min={1}
                    max={480}
                    value={env.sso.maxAgeMinutes}
                    onChange={(e) =>
                      update({
                        sso: {
                          ...env.sso!,
                          maxAgeMinutes: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
                <p>
                  Save setup, then sign in once per environment account.
                  Complete the provider’s SSO and MFA prompts in the opened
                  browser, return here, and save the session. Each test uses an
                  isolated session and checks that it is still signed in.
                </p>
                {Object.keys(env.users ?? {}).map((user) => (
                  <div className="environment-row auth-session-row" key={user}>
                    <strong>{user}</strong>
                    <span>
                      {authSessions[selected]?.[user] === "saved"
                        ? "Session saved; rechecked on run"
                        : "Sign-in required"}
                    </span>
                    <button
                      className="button"
                      disabled={
                        busy ||
                        !!signIn ||
                        JSON.stringify(env) !==
                          JSON.stringify(base.environments[selected])
                      }
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await action?.("auth/start", {
                            base,
                            environment: selected,
                            user,
                          });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Sign in {user}
                    </button>
                    <button
                      className="button"
                      disabled={!!signIn}
                      onClick={() =>
                        void action?.("auth/revoke", {
                          environment: selected,
                          user,
                        })
                      }
                    >
                      Forget session {user}
                    </button>
                  </div>
                ))}
                {signIn && (
                  <div role="status">
                    <p>
                      Sign-in open for {signIn.user} in {signIn.environment}.
                      Finish the provider’s MFA challenge, then confirm here.
                    </p>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await action?.("auth/finish", { id: signIn.id });
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Save signed-in session
                    </button>
                    <button
                      className="button"
                      onClick={() =>
                        void action?.("auth/cancel", { id: signIn.id })
                      }
                    >
                      Cancel sign-in
                    </button>
                  </div>
                )}
                <p>
                  Sessions contain credentials and are stored privately outside
                  project exports. Session reuse does not test MFA on every run.
                  Providers, SSO flows and hardware factors require validation
                  with your application.
                </p>
              </>
            )}
          </details>
          <details className="environment-card">
            <summary>Browser login setup</summary>
            <label>
              <input
                type="checkbox"
                checked={!!env.login}
                onChange={(e) =>
                  update({
                    sso: undefined,
                    login: e.target.checked
                      ? {
                          path: "login",
                          usernameLabel: "Username",
                          passwordLabel: "Password",
                          submitButton: "Sign in",
                          successPath: "",
                        }
                      : undefined,
                  })
                }
              />
              Sign in with the selected account before screen tests
            </label>
            {env.login &&
              Object.entries(env.login)
                .filter(([key]) => key !== "mfa")
                .map(([key, value]) => (
                  <label key={key}>
                    {
                      (
                        {
                          path: "Login page path",
                          usernameLabel: "Username field label",
                          passwordLabel: "Password field label",
                          submitButton: "Sign-in button text",
                          successPath: "Successful login path",
                        } as Record<string, string>
                      )[key]
                    }
                    <input
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) =>
                        update({
                          login: { ...env.login!, [key]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
            {env.login && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={!!env.login.mfa}
                    onChange={(e) =>
                      update({
                        login: {
                          ...env.login!,
                          mfa: e.target.checked
                            ? {
                                codeLabel: "Authentication code",
                                submitButton: "Verify",
                              }
                            : undefined,
                        },
                      })
                    }
                  />
                  Use TOTP MFA for these test accounts
                </label>
                {env.login.mfa && (
                  <>
                    <label>
                      MFA code field label
                      <input
                        value={env.login.mfa.codeLabel}
                        onChange={(e) =>
                          update({
                            login: {
                              ...env.login!,
                              mfa: {
                                ...env.login!.mfa!,
                                codeLabel: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      MFA verify button
                      <input
                        value={env.login.mfa.submitButton}
                        onChange={(e) =>
                          update({
                            login: {
                              ...env.login!,
                              mfa: {
                                ...env.login!.mfa!,
                                submitButton: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                    <p>
                      Set each account’s TOTP secret variable name above. Use
                      test-account seeds approved for automation;
                      push/SMS/security-key challenges use interactive sign-in.
                    </p>
                  </>
                )}
              </>
            )}
            <p>
              This supports a same-origin labeled login form. Anonymous tests
              skip this login. Use the SSO section for provider sign-in and
              interactive MFA.
            </p>
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="button primary"
        disabled={busy}
        onClick={() => void persist()}
      >
        {busy ? "Saving…" : "Save environment setup"}
      </button>
      <p>
        Environment-specific suite/case overrides and additional service URLs
        are supported in project configuration. Saved settings contain
        references, not resolved secrets.
      </p>
    </section>
  );
}
