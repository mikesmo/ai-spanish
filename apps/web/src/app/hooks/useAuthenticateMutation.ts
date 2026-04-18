"use client";

import {
  useMutation,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  fetchDeepgramAuthKey,
  type AuthenticateResponse,
} from "../services/authenticate.service";

/**
 * Retrieves a fresh auth key for speech services.
 */
export const useAuthenticateMutation = (): UseMutationResult<
  AuthenticateResponse,
  Error,
  void
> =>
  useMutation({
    mutationFn: fetchDeepgramAuthKey,
  });
