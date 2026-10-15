import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { assertPortalOrigin } from "@/lib/auth/host-payout-session";
import { loadHostPayoutRule } from "@/lib/db/repositories/host-payout-rule";
import { agencyPayoutGroups, agencyPayoutCandidates } from "@/lib/db/repositories/agency-payout-groups";
import { hostPayoutCsv } from "@/lib/reports/host-payout-csv";
import {
  hostPayoutSummary,
  listHostPayouts,
  manageHostPayout,
  manageAgencyPayoutBatch,
  PayoutError,
  payoutDestination,
  saveHostPayoutAccount,
  saveHostPayoutRule,
} from "@/lib/db/repositories/host-payouts";
const reply = (v: unknown, status = 200) =>
  NextResponse.json(v, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const filterSchema = z.object({
  search: z.string().max(100).optional(),
  agency: z.string().max(100).optional(),
  agencyGroup: z.union([z.string().uuid(),z.literal('INDEPENDENT')]).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  status: z
    .enum([
      "APPROVED",
      "PROCESSING",
      "COMPLETED",
      "FAILED",
      "REVERSED",
      "CANCELLED",
    ])
    .optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export async function GET(request: Request) {
  const account = await getSession();
  if (!account) return reply({ message: "Sign in to Control." }, 401);
  if (!["MASTER", "AGENCY"].includes(account.role))
    return reply({ message: "Your role cannot view this payout module." }, 403);
  try {
    const url = new URL(request.url),
      filters = filterSchema.parse(
        Object.fromEntries(
          [...url.searchParams].filter(
            ([k, v]) =>
              v &&
              ["search", "agency", "agencyGroup", "country", "status", "from", "to"].includes(
                k,
              ),
          ),
        ),
      );
    if (url.searchParams.has("destination"))
      return reply({
        destination: await payoutDestination(
          account,
          z.string().uuid().parse(url.searchParams.get("destination")),
        ),
      });
    if (url.searchParams.has('export')) {
      const kind=z.enum(['1','details','agencies']).parse(url.searchParams.get('export'));
      if(kind==='agencies'&&account.role!=='MASTER') return reply({message:'Only Master may export the global Agency payout list.'},403);
      return await hostPayoutCsv(account,filters,kind==='agencies'?'agencies':'details');
    }
    const rows = account.role==='MASTER'&&!filters.agencyGroup?[]:await listHostPayouts(
      { account },
      filters,
      200,
    );
    const rule = await loadHostPayoutRule();
    const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page')??'1',10)||1));
    return reply({
      rows,
      ...(account.role==='MASTER'&&!filters.agencyGroup?await agencyPayoutGroups(account,filters,page):{}),
      candidates:account.role==='MASTER'&&filters.agencyGroup?await agencyPayoutCandidates(account,filters):undefined,
      summary: await hostPayoutSummary({ account }, filters),
      rule:
        account.role === "MASTER"
          ? rule
          : {
              slabDiamonds: rule.slabDiamonds,
              hostUsd: rule.hostUsd,
              agencyUsd: rule.agencyUsd,
            },
      isMaster: account.role === "MASTER",
    });
  } catch (e) {
    return reply(
      {
        message:
          e instanceof PayoutError
            ? e.message
            : "Payout records could not load. Please retry.",
      },
      400,
    );
  }
}
export async function POST(request: Request) {
  const account = await getSession();
  if (!account) return reply({ message: "Sign in to Control." }, 401);
  if (account.role !== "MASTER")
    return reply({ message: "Only Master may manage payouts." }, 403);
  try {
    assertPortalOrigin(request);
    const body = await request.json();
    if(body.action==='agency-batch'){
      const parsed=z.object({agencyGroup:z.union([z.string().uuid(),z.literal('INDEPENDENT')]),ids:z.array(z.string().uuid()).min(1).max(100),
        kind:z.enum(['paid','agency-paid']),reference:z.string().trim().min(3).max(255),reason:z.string().trim().min(3).max(500),confirmed:z.literal(true)}).parse(body);
      return reply(await manageAgencyPayoutBatch(account,{...parsed,action:parsed.kind}));
    }
    if (body.action === "rule")
      return reply(
        await saveHostPayoutRule(
          account,
          z
            .object({
              slabDiamonds: z.number().int().positive().safe(),
              totalUsd: z.string(),
              hostUsd: z.string(),
              agencyUsd: z.string(),
              reason: z.string().min(3).max(500),
            })
            .parse(body),
        ),
      );
    if (body.action === "account")
      return reply(
        await saveHostPayoutAccount(
          z.string().uuid().parse(body.hostId),
          z
            .object({
              type: z.enum(["BANK", "UPI"]),
              displayName: z.string().min(2).max(120),
              destination: z.string().min(4).max(190),
            })
            .parse(body),
          account,
        ),
      );
    return reply(
      await manageHostPayout(
        account,
        z
          .object({
            id: z.string().uuid(),
            action: z.enum([
              "paid",
              "failed",
              "reverse",
              "note",
              "agency-paid",
              "agency-reverse",
            ]),
            reason: z.string().min(3).max(500),
            reference: z.string().max(255).optional(),
          })
          .parse(body),
      ),
    );
  } catch (e) {
    return reply(
      {
        message:
          e instanceof PayoutError
            ? e.message
            : e instanceof z.ZodError
              ? "Check the supplied payout details."
              : "Payout action failed. Retry safely using the same request.",
      },
      400,
    );
  }
}
