import { z } from "zod";

export const masterAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  asset: z.enum(["COIN", "DIAMOND"]),
  action: z.enum(["ADD", "REMOVE"]),
  amount: z.number().int().positive().safe(),
  expectedBalance: z.number().int().nonnegative().safe(),
  reason: z.string().trim().min(5).max(500),
  internalNote: z.string().trim().max(1000).default(""),
  idempotencyKey: z.string().uuid(),
  confirmed: z.literal(true),
}).strict();

export type MasterAdjustmentInput = z.infer<typeof masterAdjustmentSchema>;

export class AdjustmentError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}
