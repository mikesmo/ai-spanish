import {
  authenticateResponseSchema,
  type AuthenticateResponse,
} from "./schemas/authenticate.schema";
export type { AuthenticateResponse } from "./schemas/authenticate.schema";

/**
 * Requests a temporary Deepgram auth key from the server API.
 */
export const fetchDeepgramAuthKey = async (): Promise<AuthenticateResponse> => {
  const response = await fetch("/api/authenticate");
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error("Failed to authenticate with speech provider");
  }

  return authenticateResponseSchema.parse(payload);
};
