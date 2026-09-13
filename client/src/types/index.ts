export type UserRole = "INTERVIEWER" | "CANDIDATE";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  emailVerified: boolean;
}