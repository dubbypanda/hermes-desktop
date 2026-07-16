# Remote Management Auto Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve direct-Remote `auto` authentication before management requests choose token or OAuth transport, then update PR #855.

**Architecture:** Keep `remoteDashboardRequestJson()` as the single main-process request boundary. When configuration is `auto`, call the existing public `probeRemoteAuthMode()` once for that request, route using its explicit result, and retain existing error normalization without writing configuration.

**Tech Stack:** TypeScript 5.9, Electron 39, Vitest 4, lat.md

## Global Constraints

- Preserve explicit `token` and `oauth` behavior.
- Never expose cookies, reusable OAuth material, or session tokens to renderer code.
- Never guess, retry another transport, or fall back to local state when probing fails.
- Do not add dependencies, IPC methods, configuration writes, or renderer changes.
- Push normally to `origin/pr/02-remote-management-client`; never force-push.

---

### Task 1: Resolve Auto Authentication at Management Request Boundary

**Files:**
- Modify: `src/main/remote-api.test.ts:3-74`
- Modify: `src/main/remote-api.test.ts:76-201`
- Modify: `src/main/remote-api.ts:1-84`
- Modify: `lat.md/remote-dashboard-oauth.md:39-45`
- Modify: `lat.md/remote-dashboard-oauth.md:89-95`

**Interfaces:**
- Consumes: `probeRemoteAuthMode(baseUrl: string): Promise<{ authMode: "token" | "oauth"; version: string | null }>` from `src/main/remote-oauth.ts`.
- Produces: unchanged `remoteDashboardRequestJson<T>(connection, path, options?, profile?): Promise<T>` behavior with complete handling for `ConnectionConfig["remoteAuthMode"]`.

- [ ] **Step 1: Add probe mock and accept `auto` in test connection helper**

Update the hoisted values and OAuth module mock in `src/main/remote-api.test.ts`:

```typescript
const {
  remoteRequestJson,
  requestRemoteOAuthJson,
  probeRemoteAuthMode,
  RemoteOAuthError,
} = vi.hoisted(() => {
  class TestRemoteOAuthError extends Error {
    readonly needsOAuthLogin: boolean;

    constructor(
      message: string,
      readonly code:
        | "oauth_cancelled"
        | "oauth_connection_changed"
        | "oauth_login_required"
        | "oauth_request_failed",
      readonly statusCode?: number,
    ) {
      super(message);
      this.name = "RemoteOAuthError";
      this.needsOAuthLogin = code === "oauth_login_required";
    }
  }

  return {
    remoteRequestJson: vi.fn(),
    requestRemoteOAuthJson: vi.fn(),
    probeRemoteAuthMode: vi.fn(),
    RemoteOAuthError: TestRemoteOAuthError,
  };
});

vi.mock("./remote-oauth", () => ({
  probeRemoteAuthMode,
  requestRemoteOAuthJson,
  RemoteOAuthError,
}));

function remoteConnection(
  remoteAuthMode: ConnectionConfig["remoteAuthMode"],
): ConnectionConfig {
  return {
    mode: "remote",
    remoteUrl: "https://remote.example:9119",
    apiKey: "secret",
    remoteAuthMode,
    remoteChatTransport: "auto",
    sshChatTransport: "auto",
    ssh: {
      host: "",
      port: 22,
      username: "",
      keyPath: "",
      remotePort: 9119,
      localPort: 9119,
    },
  };
}

beforeEach(() => {
  remoteRequestJson.mockReset();
  requestRemoteOAuthJson.mockReset();
  probeRemoteAuthMode.mockReset();
});
```

- [ ] **Step 2: Write failing auto-to-OAuth regression test**

Add beside existing explicit transport tests, with the one `@lat:` reference moved from the login-error test to this primary routing test so the spec retains exactly one code mention:

```typescript
it("resolves auto authentication to OAuth before selecting transport", async () => {
  // @lat: [[remote-dashboard-oauth#Test specifications#Management authentication routing]]
  probeRemoteAuthMode.mockResolvedValue({
    authMode: "oauth",
    version: "1.2.3",
  });
  requestRemoteOAuthJson.mockResolvedValue({ profiles: [] });

  await expect(
    remoteDashboardRequestJson(
      remoteConnection("auto"),
      "/api/profiles",
      {},
      "research",
    ),
  ).resolves.toEqual({ profiles: [] });

  expect(probeRemoteAuthMode).toHaveBeenCalledOnce();
  expect(probeRemoteAuthMode).toHaveBeenCalledWith(
    "https://remote.example:9119",
  );
  expect(requestRemoteOAuthJson).toHaveBeenCalledWith(
    "https://remote.example:9119/api/profiles?profile=research",
    {},
  );
  expect(remoteRequestJson).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run focused test and verify RED**

Run:

```bash
env NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/main/remote-api.test.ts --reporter=verbose
```

Expected: new test fails because `probeRemoteAuthMode` is never called and current implementation selects token transport for `auto`.

- [ ] **Step 4: Write failing auto-to-token regression test**

```typescript
it("resolves auto authentication to token before selecting transport", async () => {
  probeRemoteAuthMode.mockResolvedValue({ authMode: "token", version: null });
  remoteRequestJson.mockResolvedValue({ ok: true });

  await expect(
    remoteDashboardRequestJson(
      remoteConnection("auto"),
      "/api/tools/toolsets",
      { method: "PUT", body: { enabled: true } },
      "research",
    ),
  ).resolves.toEqual({ ok: true });

  expect(probeRemoteAuthMode).toHaveBeenCalledOnce();
  expect(probeRemoteAuthMode).toHaveBeenCalledWith(
    "https://remote.example:9119",
  );
  expect(remoteRequestJson).toHaveBeenCalledWith(
    {
      remoteUrl: "https://remote.example:9119",
      apiKey: "secret",
      profile: "research",
    },
    "/api/tools/toolsets",
    { method: "PUT", body: { enabled: true } },
  );
  expect(requestRemoteOAuthJson).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Run focused test and verify both new tests fail for intended reason**

Run:

```bash
env NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/main/remote-api.test.ts --reporter=verbose
```

Expected: auto-to-OAuth fails because token transport is selected; both tests fail their probe assertions because probe is never called.

- [ ] **Step 6: Implement minimal request-scoped resolution**

Import `probeRemoteAuthMode` in `src/main/remote-api.ts`, then resolve mode inside the existing `try` block:

```typescript
import {
  probeRemoteAuthMode,
  RemoteOAuthError,
  requestRemoteOAuthJson,
  type RemoteOAuthRequestOptions,
} from "./remote-oauth";

// Inside remoteDashboardRequestJson(), after config construction:
try {
  const authMode =
    connection.remoteAuthMode === "auto"
      ? (await probeRemoteAuthMode(connection.remoteUrl)).authMode
      : connection.remoteAuthMode;

  if (authMode === "oauth") {
    return (await requestRemoteOAuthJson(
      dashboardApiUrl(config, path),
      options,
    )) as T;
  }

  return await remoteRequestJson<T>(config, path, options);
} catch (error) {
  throw normalizeRemoteDashboardError(error);
}
```

- [ ] **Step 7: Verify GREEN and explicit-mode non-probing**

Add `expect(probeRemoteAuthMode).not.toHaveBeenCalled()` to existing explicit token and explicit OAuth tests. Then run:

```bash
env NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/main/remote-api.test.ts --reporter=verbose
```

Expected: all request-client tests pass; both auto paths probe once; explicit paths never probe.

- [ ] **Step 8: Update lat.md behavior and test specification**

Replace the authenticated-boundary routing sentence with:

```markdown
[[src/main/remote-api.ts#remoteDashboardRequestJson]] resolves `auto` through the public status probe, routes OAuth through the persistent Electron partition, and routes token mode through `X-Hermes-Session-Token`. Probe failures never guess another transport or fall back to local state.
```

Replace the Management authentication routing overview with:

```markdown
Management requests resolve `auto` before selecting token or OAuth transport, preserve profile scoping, skip probing for explicit modes, reject non-Remote callers, and retain OAuth login-required errors for reauthentication.
```

- [ ] **Step 9: Run complete verification**

Run:

```bash
env NODE_OPTIONS=--no-experimental-webstorage npm test
npm run typecheck
npx --yes lat.md check
git diff --check
git status --short --branch
```

Expected: 164 test files pass with 1,751 existing tests plus 2 new tests, 3 existing skips; node/web typechecks pass; lat links and code refs pass; no whitespace errors; only intended source, test, documentation, spec, and plan changes tracked. Scratch `node_modules` paths remain untracked and unstaged.

- [ ] **Step 10: Commit verified fix**

```bash
git add src/main/remote-api.ts src/main/remote-api.test.ts lat.md/remote-dashboard-oauth.md docs/superpowers/plans/2026-07-16-remote-management-auto-auth.md
git commit -m "fix: resolve automatic remote authentication"
```

- [ ] **Step 11: Push without rewriting history and verify PR head**

Pre-push gate:

```bash
git status --short --branch
git log --oneline --decorate -3
git push origin pr/02-remote-management-client
```

Expected: normal fast-forward push succeeds. Query PR #855 and verify its head SHA equals local `HEAD`; verify GitHub check runs start against that SHA. Do not report CI passing until completed check results are observed.
