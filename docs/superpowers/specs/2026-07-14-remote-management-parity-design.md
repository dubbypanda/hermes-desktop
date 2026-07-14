# Remote Management Parity Design

## Goal

Hermes One will manage supported remote Hermes Agent features without reading or mutating local Hermes state while connected through direct Remote mode.

This phase covers shared authenticated dashboard requests, Skills, platform Toolsets, Profiles, and Gateway lifecycle. Memory, Kanban, Providers, Discover workflows, and binary uploads remain separate phases.

## Safety boundary

Direct Remote mode must never fall through to local filesystem or CLI operations. Every remote-aware IPC handler must either call authenticated dashboard API or return explicit unsupported result.

OAuth cookies remain main-process-only. Token requests continue using `X-Hermes-Session-Token`. Renderer receives feature data and operation results, never cookies or reusable OAuth material.

## Shared dashboard client

New focused main-process client accepts `ConnectionConfig`, API path, optional profile, HTTP method, body, and timeout.

- OAuth mode builds profile-scoped URL and delegates to `requestRemoteOAuthJson`.
- Token mode delegates to existing `remoteRequestJson`.
- Non-Remote connection is rejected.
- HTTP 404 can be classified as unsupported capability by feature adapters.

This client becomes direct Remote-mode boundary for new management adapters. SSH keeps existing dashboard or SSH fallbacks.

## Feature adapters

Skills adapter uses shared client for list, content, install, and uninstall. Existing marker-path profile routing remains unchanged.

Toolsets adapter maps Agent `{name,label,description,enabled}` rows to Desktop `{key,label,description,enabled}` and sends toggles to `/api/tools/toolsets/{name}`.

Profiles adapter maps Agent profile rows into `ProfileInfo`. Server-owned fields populate when supplied; Desktop-only avatar and color use stable non-secret defaults. Create, delete, active-profile, and Soul operations call existing Agent endpoints.

Gateway adapter reads `gateway_running` from profile-scoped `/api/status` and calls start, stop, or restart endpoints. Spawn acceptance means operation started, not completed; UI refreshes status afterward.

## Renderer behavior

Skills, Toolsets, Profiles, and Gateway screens render in Remote mode after adapters exist. Local-only actions remain hidden or disabled:

- profile avatar/color editing;
- cloud Agent Sync controls;
- opening remote profile terminal;
- local API-server-key generation;
- local filesystem paths.

Unsupported older Agent endpoints produce feature-scoped notice or operation error. Whole application does not fall back to local state.

## Error behavior

Authentication failures preserve OAuth reauthentication semantics. Network errors remain actionable. HTTP 404 means server version lacks feature; other HTTP failures surface server detail.

Mutation responses distinguish request acceptance from observed completion. Create/delete/toggle operations refresh authoritative remote list before UI claims new state.

## Testing

Implementation follows failing-test-first TDD.

Focused tests cover token and OAuth request routing, profile query scoping, remote Skills behavior, Toolset mapping/toggle, Profile mapping/CRUD/Soul, Gateway lifecycle/status, and renderer gates. Negative tests prove direct Remote handlers never invoke local implementations.

Verification includes focused Vitest tests, Node and renderer typechecks, production build, `lat check`, and `git diff --check`. Existing unrelated baseline failures remain separately reported.

## Acceptance criteria

With direct Remote mode configured for token or OAuth authentication, Skills, Toolsets, Profiles, and Gateway read and mutate server state through Agent dashboard APIs.

No operation in this phase reads or writes local Hermes profile/config state as fallback. Missing server capability disables only affected feature and names required Agent upgrade.
