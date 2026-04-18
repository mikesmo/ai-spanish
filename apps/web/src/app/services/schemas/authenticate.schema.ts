import { z } from "zod";

export const authenticateResponseSchema = z
  .object({
    key: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type AuthenticateResponse = z.infer<typeof authenticateResponseSchema>;
