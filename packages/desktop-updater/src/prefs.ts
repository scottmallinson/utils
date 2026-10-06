// The user's update preferences, saved as JSON next to the app's other data.

export interface UpdatePrefs {
  /** Check on launch and once a day. */
  autoCheck: boolean;
  /** A version the user chose to skip; automatic checks don't mention it again. */
  skipVersion?: string;
}

export const DEFAULT_PREFS: UpdatePrefs = { autoCheck: true };

export function parsePrefs(value: unknown): UpdatePrefs {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PREFS };
  const { autoCheck, skipVersion } = value as Record<string, unknown>;
  return {
    autoCheck: typeof autoCheck === 'boolean' ? autoCheck : DEFAULT_PREFS.autoCheck,
    ...(typeof skipVersion === 'string' ? { skipVersion } : {}),
  };
}
