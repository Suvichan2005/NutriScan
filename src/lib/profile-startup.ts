import type { Profile } from './contracts';

/**
 * A delayed IndexedDB result may arrive after onboarding has opened. A profile
 * the user has already started editing is authoritative for this tab.
 */
export function chooseUntouchedStartupProfile(
  remembered: Profile | null,
  session: Profile | null,
  userTouched: boolean,
): Profile | undefined {
  if (userTouched) return undefined;
  return remembered ?? session ?? undefined;
}
