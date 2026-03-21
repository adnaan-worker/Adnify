export interface ShellPreset {
  id: string;
  name: string;
  shellPath?: string;
  cwd?: string;
  args?: string[];
  isDefault?: boolean;
  visibleInMenu?: boolean;
  group?: string;
  favorite?: boolean;
}

export interface RemoteServerConfig {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  remotePath?: string;
}

export interface RemoteFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifyTime?: number;
}

export interface ShellLink {
  id: string;
  name: string;
  type: 'local-shell' | 'directory' | 'remote' | 'command';
  target: string;
  shellPath?: string;
  args?: string[];
  visibleInMenu?: boolean;
  remote?: RemoteServerConfig;
  group?: string;
  favorite?: boolean;
  cwd?: string;
}

export interface AvailableShell {
  label: string;
  path: string;
}

export interface ShellState {
  defaultShell?: string;
  presets: ShellPreset[];
  links: ShellLink[];
}

export interface CreateShellSessionOptions {
  name: string;
  cwd: string;
  shell?: string;
  startupCommand?: string;
  remote?: RemoteServerConfig;
}

export interface CreateShellRequest {
  shellPath?: string;
  shellName?: string;
  cwd?: string;
  startupCommand?: string;
}

export interface ResolvedShellLaunch {
  name: string;
  cwd: string;
  shell?: string;
  startupCommand?: string;
  remote?: RemoteServerConfig;
}

export interface ResolveShellLaunchContext {
  availableShells: AvailableShell[];
  defaultShell?: string;
  selectedRoot?: string;
  workspaceRoots?: string[];
}

export interface OpenRemoteServerOptions {
  name: string;
  server: RemoteServerConfig;
  shell?: string;
  localCwd: string;
}

export const DEFAULT_REMOTE_PORT = 22;
