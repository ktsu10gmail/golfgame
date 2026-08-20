const LEGACY_CUSTOM_NAME = /^(?:80|90|100)\+\s*(?:player)?\s*(?:[-·]\s*)?custom(?:\s+profile)?$/i;
const LEGACY_CUSTOM_DESCRIPTION = /^based on (?:80|90|100)\+ player$/i;

export function playerProfileName(playerName) {
  const cleanName = String(playerName || "").trim().replace(/\s+/g, " ");
  if (!cleanName) return "My profile";
  const suffix = " profile";
  return `${cleanName.slice(0, 40 - suffix.length).trim()}${suffix}`;
}

export function personalizeCustomProfile(profile, playerName) {
  if (!profile?.id?.startsWith("custom")) return profile;
  const legacyName = LEGACY_CUSTOM_NAME.test(String(profile.name || "").trim());
  const legacyDescription = LEGACY_CUSTOM_DESCRIPTION.test(String(profile.description || "").trim());
  if (!legacyName && !legacyDescription) return profile;
  return {
    ...profile,
    name: legacyName ? playerProfileName(playerName) : profile.name,
    description: legacyDescription
      ? "Personal club distances and putting statistics"
      : profile.description
  };
}
