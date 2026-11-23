export function validInvitee(email: string): boolean {
  return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email) && !/[\r\n]/.test(email);
}
