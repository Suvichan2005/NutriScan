import { hasUserContext, type Profile } from './contracts';

/** Keeping context locally is separate from permission to put it in a provider request. */
export function profileForGemini(profile: Profile, share: boolean): Profile | undefined {
  return share && hasUserContext(profile) ? profile : undefined;
}

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
