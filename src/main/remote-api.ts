import type { ConnectionConfig } from "./config";
import {
  requestRemoteOAuthJson,
  type RemoteOAuthRequestOptions,
} from "./remote-oauth";
import {
  dashboardApiUrl,
  remoteRequestJson,
  type RemoteSessionConfig,
} from "./remote-sessions";

export type RemoteDashboardRequestOptions = RemoteOAuthRequestOptions;

/**
 * Authenticated direct-Remote dashboard request boundary.
 *
 * OAuth requests stay in Electron's persistent cookie partition. Token
 * requests keep the existing X-Hermes-Session-Token transport. Callers must
 * select this only for direct Remote mode; local and SSH have separate paths.
 */
export function remoteDashboardRequestJson<T>(
  connection: ConnectionConfig,
  path: string,
  options: RemoteDashboardRequestOptions = {},
  profile?: string,
): Promise<T> {
  if (connection.mode !== "remote") {
    return Promise.reject(
      new Error("Remote dashboard API is available only in direct Remote mode."),
    );
  }

  const config: RemoteSessionConfig = {
    remoteUrl: connection.remoteUrl,
    apiKey: connection.apiKey,
    profile,
  };

  if (connection.remoteAuthMode === "oauth") {
    return requestRemoteOAuthJson(
      dashboardApiUrl(config, path),
      options,
    ) as Promise<T>;
  }

  return remoteRequestJson<T>(config, path, options);
}
