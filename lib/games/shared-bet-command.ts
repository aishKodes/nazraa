import { z } from 'zod';
import { LION_VS_TIGER_ID } from './lion-vs-tiger';

export const sharedBetCommandSchema = z.object({
  requestId: z.string().uuid(), roundId: z.string().uuid(),
  game: z.enum(['teen_patti','teen_patti_pro','luck77','greedy_lion','greedy_king','bounty_football','lion_vs_tiger']),
  bets: z.record(z.string().regex(/^[a-z0-9_]+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)),
}).superRefine((command, context) => {
  // Other games retain their existing HTTP limit and repository limits.
  if (command.game !== LION_VS_TIGER_ID && Object.values(command.bets).some(amount => amount > 50_000_000)) {
    context.addIssue({code:'custom',path:['bets'],message:'Choose a valid game amount.'});
  }
});
