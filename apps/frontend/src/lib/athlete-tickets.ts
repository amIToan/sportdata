type RegistrationStatus = { status: string; paymentStatus: string };

export function isTicketIssued(registration: RegistrationStatus) {
  return registration.status === 'CONFIRMED'
    && (registration.paymentStatus === 'PAID' || registration.paymentStatus === 'NOT_REQUIRED');
}

// Keep pending payment/approval records visible while showing one issued pass
// per athlete and event. Use IDs, never names, to distinguish athletes.
export function distinctAthleteTickets<T extends RegistrationStatus>(
  registrations: T[],
  athleteEventKey: (registration: T) => string,
): T[] {
  const seen = new Set<string>();
  return registrations.filter((registration) => {
    if (!isTicketIssued(registration)) return true;
    const key = athleteEventKey(registration);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
