// Platform decisions and the commands that swap in an update once the app has quit.

import type { InstallMethod } from './releases';

export interface Environment {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** `process.execPath`. */
  exePath: string;
  env: Record<string, string | undefined>;
}

/**
 * The .app bundle the app runs from, e.g. `/Applications/PDF Maker.app`, or undefined when it
 * isn't a normal bundle or macOS is running it from a read-only translocated copy.
 */
export function macAppBundle(exePath: string): string | undefined {
  const match = /^(\/.+?\.app)\/Contents\/MacOS\/[^/]+$/.exec(exePath);
  if (!match?.[1] || match[1].includes('/AppTranslocation/')) return undefined;
  return match[1];
}

/** How this copy could update itself, before checking it is allowed to write to its folder. */
export function installMethod(environment: Environment): InstallMethod {
  if (!environment.isPackaged) return 'manual';
  switch (environment.platform) {
    case 'darwin':
      return macAppBundle(environment.exePath) ? 'mac-zip' : 'manual';
    case 'win32':
      // electron-builder's portable build sets this; it has nothing to install over.
      return environment.env.PORTABLE_EXECUTABLE_FILE ? 'manual' : 'win-nsis';
    default:
      return 'manual';
  }
}

/**
 * Waits for the app to quit, swaps the new bundle in (putting the old one back if that fails),
 * and optionally opens it again. Arguments: pid, current bundle, new bundle, relaunch (1 or 0).
 */
export const MAC_SWAP_SCRIPT = `#!/bin/sh
pid="$1"; app="$2"; new="$3"; relaunch="$4"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
old="$app.old-$$"
if mv "$app" "$old"; then
  if mv "$new" "$app"; then
    rm -rf "$old"
  else
    mv "$old" "$app"
  fi
fi
xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
if [ "$relaunch" = 1 ]; then open "$app"; fi
`;

export type PreparedUpdate =
  | { method: 'mac-zip'; script: string; bundle: string; newBundle: string }
  | { method: 'win-nsis'; installer: string };

/** The detached process to start as the app quits. */
export function installCommand(
  prepared: PreparedUpdate,
  pid: number,
  relaunch: boolean,
): { command: string; args: string[] } {
  if (prepared.method === 'mac-zip') {
    return {
      command: '/bin/sh',
      args: [
        prepared.script,
        String(pid),
        prepared.bundle,
        prepared.newBundle,
        relaunch ? '1' : '0',
      ],
    };
  }
  // electron-builder's NSIS installer: silent, waits for the app to close, reuses its folder.
  return {
    command: prepared.installer,
    args: ['/S', '--updated', ...(relaunch ? ['--force-run'] : [])],
  };
}
