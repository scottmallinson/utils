// Finds the newest release of one app in a repo that publishes several, and the file to
// install it from. Release tags look like `<name>-v<version>`, e.g. `pdf-maker-v0.1.2`, and
// electron-builder names the files `<name>-<version>-<os>-<arch>.<ext>`.

/** How this copy of the app can be updated. */
export type InstallMethod =
  /** Replace the .app bundle with the one in the release's .zip (macOS). */
  | 'mac-zip'
  /** Run the release's NSIS installer silently (Windows, installed copy). */
  | 'win-nsis'
  /** Send the user to the release page (portable, development, or not writable). */
  | 'manual';

export interface Release {
  tag: string;
  pageUrl: string;
  assets: Asset[];
}

export interface Asset {
  name: string;
  url: string;
  size: number;
  /** Hex SHA-256 from GitHub's asset digest, if it has one. */
  sha256?: string;
}

export interface Update {
  version: string;
  pageUrl: string;
  /** The file to install from; absent when the update has to be downloaded by hand. */
  asset?: Asset;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SHA256 = /^sha256:([0-9a-f]{64})$/;

/** Reads GitHub's "list releases" response, skipping drafts, prereleases and anything odd. */
export function parseReleases(value: unknown): Release[] {
  if (!Array.isArray(value)) return [];
  const releases: Release[] = [];
  for (const raw of value) {
    if (!isObject(raw) || raw.draft === true || raw.prerelease === true) continue;
    if (typeof raw.tag_name !== 'string' || typeof raw.html_url !== 'string') continue;
    const assets: Asset[] = [];
    for (const asset of Array.isArray(raw.assets) ? raw.assets : []) {
      if (!isObject(asset)) continue;
      const { name, browser_download_url: url, size, digest } = asset;
      if (typeof name !== 'string' || typeof url !== 'string' || typeof size !== 'number') continue;
      const sha256 = typeof digest === 'string' ? SHA256.exec(digest)?.[1] : undefined;
      assets.push({ name, url, size, ...(sha256 ? { sha256 } : {}) });
    }
    releases.push({ tag: raw.tag_name, pageUrl: raw.html_url, assets });
  }
  return releases;
}

/** Parses a plain `major.minor.patch` version; anything else (e.g. prereleases) is undefined. */
export function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative if a < b, positive if a > b, 0 if equal. Both must parse. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Not a version: ${left ? b : a}`);
  for (let index = 0; index < 3; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The release file to install from for this method and CPU, or undefined if there isn't one. */
export function assetName(
  name: string,
  version: string,
  method: InstallMethod,
  arch: string,
): string | undefined {
  if (arch !== 'x64' && arch !== 'arm64') return undefined;
  switch (method) {
    case 'mac-zip':
      return `${name}-${version}-mac-${arch}.zip`;
    case 'win-nsis':
      return `${name}-${version}-win-${arch}.exe`;
    case 'manual':
      return undefined;
  }
}

export interface FindUpdateOptions {
  /** The app's package name, which prefixes its release tags. */
  name: string;
  currentVersion: string;
  method: InstallMethod;
  arch: string;
}

/**
 * The newest release of this app that is newer than the running one, or undefined. The update
 * only carries an asset when it can be installed automatically: the file exists and GitHub
 * published its SHA-256 to check the download against.
 */
export function findUpdate(releases: Release[], options: FindUpdateOptions): Update | undefined {
  const prefix = `${options.name}-v`;
  let newest: { version: string; release: Release } | undefined;
  for (const release of releases) {
    if (!release.tag.startsWith(prefix)) continue;
    const version = release.tag.slice(prefix.length);
    if (!parseVersion(version)) continue;
    if (compareVersions(version, options.currentVersion) <= 0) continue;
    if (newest && compareVersions(version, newest.version) <= 0) continue;
    newest = { version, release };
  }
  if (!newest) return undefined;
  const wanted = assetName(options.name, newest.version, options.method, options.arch);
  const asset = newest.release.assets.find((candidate) => candidate.name === wanted);
  return {
    version: newest.version,
    pageUrl: newest.release.pageUrl,
    ...(asset?.sha256 ? { asset } : {}),
  };
}
