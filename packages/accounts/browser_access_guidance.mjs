function readableDate(value, formatDate) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return formatDate(date);
}

export function buildAccessGuidance(access = null, formatDate = date => date.toLocaleString([], { timeZoneName: "short" })) {
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
  const sponsorship = access?.coach_sponsorship || null;
  const continuation = access?.continuation || null;
  const graceDeadline = readableDate(sponsorship?.grace_ends_at, formatDate);
  const withLifecycle = presentation => ({
    ...presentation,
    showSponsorshipNotice: sponsorship?.status === "GRACE" || sponsorship?.status === "ENDED",
    sponsorshipTitle: sponsorship?.status === "GRACE"
      ? "Coach sponsorship — grace period"
      : "Coach-sponsored access ended",
    sponsorshipDetail: sponsorship?.status === "GRACE"
      ? `Your Coach-sponsored access remains active until ${graceDeadline || "the deadline in your profile"}. Your account and saved history remain yours.`
      : sponsorship?.status === "ENDED"
        ? `${grants.length ? "Your other valid Jetta access remains active." : "Your Coach-provided entitlement has ended."} Your account, history, and coaching relationship remain available.`
        : "",
    showContinuation: continuation?.eligible === true,
    continuationTitle: "Preferred continuation eligibility",
    continuationDetail: continuation?.eligible
      ? `$${continuation.display_monthly_usd}/month or $${continuation.display_annual_usd}/year. Online subscription activation is not yet available. Your eligibility has been saved.`
      : "",
  });

  if (!active) {
    return withLifecycle({
      title: "Historical Access",
      detail: "You can still view your saved Jetta history.",
      guidance: access?.can_start_new_play
        ? `No valid entitlement currently permits new play. Runtime remains allowed by ${String(access?.enforcement || "current").toUpperCase()} enforcement. You can activate valid Jetta access or accept a sponsored Coach invitation for entitled play.`
        : "New play is unavailable without a valid entitlement. You can activate valid Jetta access or accept a sponsored Coach invitation. Your saved history remains available.",
      codeLabel: "Have a Jetta Access Code?",
      codeHelp: "Enter a valid code provided by Jetta, or accept a Coach invitation if your Coach is sponsoring you.",
      showCoachDashboard: roles.has("COACH")
    });
  }

  if (coachAccess) {
    return withLifecycle({
      title: "Active — Coach Access",
      detail: `Your Coach access includes your own Jetta play and up to 10 sponsored student seats.${expiryCopy}`,
      guidance: "Manage students, invitations, sponsored seats, and student rounds from Coach Dashboard.",
      codeLabel: "Have another Jetta Access Code?",
      codeHelp: "You do not need another code while your Coach access is active. Use a code only when Jetta provides one for separate access.",
      showCoachDashboard: true
    });
  }

  if (sponsored) {
    return withLifecycle({
      title: "Active — Provided by Your Coach",
      detail: sponsorship?.status === "GRACE"
        ? `${coach?.coach_name || "Your Coach"} currently provides your access during a grace period.`
        : `${coach?.coach_name ? `${coach.coach_name} currently provides` : "Your Coach currently provides"} your Jetta access.${expiryCopy}`,
      guidance: `${hasAnotherGrant ? "Your other active Jetta access also remains available. " : ""}${sponsorship?.status === "GRACE" ? "See the exact Coach-sponsored deadline below." : "You do not need a Jetta Access Code while your Coach sponsorship remains active."}`,
      codeLabel: "Have another Jetta Access Code?",
      codeHelp: "Coach sponsorship already provides access. Use a code only when Jetta gives you separate Individual, promotional, or Coach access.",
      showCoachDashboard: roles.has("COACH")
    });
  }

  if (individual) {
    return withLifecycle({
      title: "Active — Individual Access",
      detail: `Your Individual access lets you start Jetta activities.${expiryCopy}`,
      guidance: "Your saved history and any coaching relationship remain separate from this access.",
      codeLabel: "Have another Jetta Access Code?",
      codeHelp: "You do not need another code while your current access is active. Use a code only when Jetta provides one for additional access.",
      showCoachDashboard: roles.has("COACH")
    });
  }

  return withLifecycle({
    title: promotional ? "Active — Promotional Access" : "Active — Jetta Access",
    detail: `You can start Jetta rounds, GPS sessions, Academy lessons, and matches.${expiryCopy}`,
    guidance: "Your saved Jetta history remains available after this access expires.",
    codeLabel: "Have another Jetta Access Code?",
    codeHelp: "You do not need another code while your current access is active. Use a code only when Jetta provides one for additional access.",
    showCoachDashboard: roles.has("COACH")
  });
}
