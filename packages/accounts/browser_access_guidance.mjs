function readableDate(value, formatDate) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date);
}

export function buildAccessGuidance(access = null, formatDate = date => date.toLocaleDateString()) {
  const grants = Array.isArray(access?.grants) ? access.grants : [];
  const roles = new Set(Array.isArray(access?.roles) ? access.roles : []);
  const byType = new Map(grants.map(grant => [grant.type, grant]));
  const active = access?.play_access === "ACTIVE" && grants.length > 0;
  const coach = access?.current_coach || null;
  const coachAccess = roles.has("COACH") && byType.has("COACH_SELF");
  const sponsored = byType.has("COACH_SPONSORED");
  const individual = byType.has("SELF_PAID");
  const promotional = byType.has("PROMOTIONAL");
  const selectedGrant = coachAccess
    ? byType.get("COACH_SELF")
    : sponsored
      ? byType.get("COACH_SPONSORED")
      : individual
        ? byType.get("SELF_PAID")
        : promotional
          ? byType.get("PROMOTIONAL")
          : grants[0];
  const expiry = readableDate(selectedGrant?.expires_at, formatDate);
  const expiryCopy = expiry ? ` Available through ${expiry}.` : "";
  const hasAnotherGrant = sponsored && grants.some(grant => grant.type !== "COACH_SPONSORED");

  if (!active) {
    return {
      title: "Historical Access",
      detail: "You can still view your saved Jetta history.",
      guidance: "To start new entitled activities when licensing enforcement is enabled, activate valid Jetta access or accept a sponsored Coach invitation.",
      codeLabel: "Have a Jetta Access Code?",
      codeHelp: "Enter a valid code provided by Jetta, or accept a Coach invitation if your Coach is sponsoring you.",
      showCoachDashboard: roles.has("COACH")
    };
  }

  if (coachAccess) {
    return {
      title: "Active — Coach Access",
      detail: `Your Coach access includes your own Jetta play and up to 10 sponsored student seats.${expiryCopy}`,
      guidance: "Manage students, invitations, sponsored seats, and student rounds from Coach Dashboard.",
      codeLabel: "Have another Jetta Access Code?",
      codeHelp: "You do not need another code while your Coach access is active. Use a code only when Jetta provides one for separate access.",
      showCoachDashboard: true
    };
  }

  if (sponsored) {
    return {
      title: "Active — Provided by Your Coach",
      detail: `${coach?.coach_name ? `${coach.coach_name} currently provides` : "Your Coach currently provides"} your Jetta access.${expiryCopy}`,
      guidance: `${hasAnotherGrant ? "Your other active Jetta access also remains available. " : ""}You do not need a Jetta Access Code while your Coach sponsorship remains active.`,
      codeLabel: "Have another Jetta Access Code?",
      codeHelp: "Coach sponsorship already provides access. Use a code only when Jetta gives you separate Individual, promotional, or Coach access.",
      showCoachDashboard: roles.has("COACH")
    };
  }

  if (individual) {
    return {
      title: "Active — Individual Access",
      detail: `Your Individual access lets you start Jetta activities.${expiryCopy}`,
      guidance: "Your saved history and any coaching relationship remain separate from this access.",
      codeLabel: "Have another Jetta Access Code?",
      codeHelp: "You do not need another code while your current access is active. Use a code only when Jetta provides one for additional access.",
      showCoachDashboard: roles.has("COACH")
    };
  }

  return {
    title: promotional ? "Active — Promotional Access" : "Active — Jetta Access",
    detail: `You can start Jetta rounds, GPS sessions, Academy lessons, and matches.${expiryCopy}`,
    guidance: "Your saved Jetta history remains available after this access expires.",
    codeLabel: "Have another Jetta Access Code?",
    codeHelp: "You do not need another code while your current access is active. Use a code only when Jetta provides one for additional access.",
    showCoachDashboard: roles.has("COACH")
  };
}
