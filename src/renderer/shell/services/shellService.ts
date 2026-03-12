import { terminalManager } from '@/renderer/services/TerminalManager';
import { api } from '@/renderer/services/electronAPI';
import type {
  AvailableShell,
  CreateShellSessionOptions,
  OpenRemoteServerOptions,
  RemoteServerConfig,
  ResolveShellLaunchContext,
  ResolvedShellLaunch,
  ShellLink,
  ShellPreset,
} from '../types';

class ShellService {
  async getAvailableShells(): Promise<AvailableShell[]> {
    try {
      const shells = await api.terminal.getShells();
      return shells?.length ? shells : [{ label: 'Terminal', path: '' }];
    } catch {
      return [{ label: 'Terminal', path: '' }];
    }
  }

  resolveDefaultShell(context: ResolveShellLaunchContext): {
    shell?: string;
    shellName: string;
  } {
    const preferredShell =
      context.availableShells.find((shell) => shell.path === context.defaultShell) ||
      context.availableShells.find((shell) => shell.label.toLowerCase().includes('zsh')) ||
      context.availableShells[0];

    return {
      shell: context.defaultShell || preferredShell?.path,
      shellName: preferredShell?.label || context.availableShells[0]?.label || 'Terminal',
    };
  }

  resolveCwd(context: ResolveShellLaunchContext, requestedCwd?: string): string {
    return requestedCwd || context.selectedRoot || context.workspaceRoots?.[0] || '';
  }

  buildRemoteCommand(server: RemoteServerConfig): string {
    const host = server.host.trim();
    const username = server.username?.trim();
    const login = username ? `${username}@${host}` : host;
    const port = server.port && server.port > 0 ? server.port : 22;
    const privateKey = server.privateKeyPath?.trim();
    const remotePath = server.remotePath?.trim();

    const args: string[] = ['ssh', '-tt', '-o', 'StrictHostKeyChecking=accept-new'];
    if (port !== 22) args.push('-p', String(port));
    if (privateKey) args.push('-i', this.quoteShellArg(privateKey));
    args.push(login);
    if (remotePath) {
      args.push(`'cd ${this.escapeSingleQuotes(remotePath)} && exec ${process.platform === 'win32' ? 'bash' : '$SHELL -l'}'`);
    }

    return args.join(' ');
  }

  private quoteShellArg(value: string): string {
    return `'${this.escapeSingleQuotes(value)}'`;
  }

  private escapeSingleQuotes(value: string): string {
    return value.replace(/'/g, `'\\''`);
  }

  async createSession(options: CreateShellSessionOptions) {
    const terminalId = await terminalManager.createTerminal({
      name: options.name,
      cwd: options.cwd,
      shell: options.shell,
      remote: options.remote,
    });

    if (options.startupCommand) {
      window.setTimeout(() => {
        terminalManager.writeToTerminal(terminalId, `${options.startupCommand}\r`);
      }, 80);
    }

    return terminalId;
  }

  resolvePresetLaunch(
    preset: ShellPreset,
    context: ResolveShellLaunchContext,
  ): ResolvedShellLaunch {
    const fallback = this.resolveDefaultShell(context);
    return {
      name: preset.name,
      cwd: this.resolveCwd(context, preset.cwd),
      shell: preset.shellPath || fallback.shell,
      startupCommand: preset.args?.join(' '),
    };
  }

  resolveLinkLaunch(
    link: ShellLink,
    context: ResolveShellLaunchContext,
  ): ResolvedShellLaunch | null {
    const fallback = this.resolveDefaultShell(context);

    if (link.type === 'directory') {
      return {
        name: link.name,
        cwd: this.resolveCwd(context, link.target),
        shell: link.shellPath || fallback.shell,
        startupCommand: link.args?.join(' '),
      };
    }

    if (link.type === 'local-shell') {
      return {
        name: link.name,
        cwd: this.resolveCwd(context, undefined),
        shell: link.shellPath || link.target || fallback.shell,
        startupCommand: link.args?.join(' '),
      };
    }

    if (link.type === 'remote') {
      const server = link.remote || this.parseRemoteTarget(link.target);
      const cwd = this.resolveCwd(context, undefined);
      if (!cwd || !server?.host) return null;
      return this.openRemoteServerLaunch({
        name: link.name,
        shell: link.shellPath || fallback.shell,
        localCwd: cwd,
        server,
      });
    }

    if (link.type === 'command') {
      const cwd = this.resolveCwd(context, link.cwd);
      if (!cwd) return null;
      return {
        name: link.name,
        cwd,
        shell: link.shellPath || fallback.shell,
        startupCommand: link.target,
      };
    }

    return null;
  }

  openRemoteServerLaunch(options: OpenRemoteServerOptions): ResolvedShellLaunch {
    return {
      name: options.name,
      cwd: options.localCwd,
      shell: options.shell,
      remote: options.server,
    };
  }

  parseRemoteTarget(target: string): RemoteServerConfig | null {
    const raw = target.trim();
    if (!raw) return null;

    const [loginPart, remotePathPart] = raw.split('|').map((part) => part.trim());
    const atIndex = loginPart.lastIndexOf('@');
    const hostPart = atIndex >= 0 ? loginPart.slice(atIndex + 1) : loginPart;
    const username = atIndex >= 0 ? loginPart.slice(0, atIndex) : undefined;

    let host = hostPart;
    let port: number | undefined;
    const portIndex = hostPart.lastIndexOf(':');
    if (portIndex > -1 && hostPart.indexOf(']') === -1) {
      const maybePort = Number(hostPart.slice(portIndex + 1));
      if (!Number.isNaN(maybePort)) {
        host = hostPart.slice(0, portIndex);
        port = maybePort;
      }
    }

    if (!host) return null;

    return {
      host,
      port,
      username,
      password: undefined,
      remotePath: remotePathPart || undefined,
    };
  }

  async openPreset(preset: ShellPreset, context: ResolveShellLaunchContext) {
    return this.createSession(this.resolvePresetLaunch(preset, context));
  }

  async openLink(link: ShellLink, context: ResolveShellLaunchContext) {
    const launch = this.resolveLinkLaunch(link, context);
    if (!launch) return null;
    return this.createSession(launch);
  }
}

export const shellService = new ShellService();
