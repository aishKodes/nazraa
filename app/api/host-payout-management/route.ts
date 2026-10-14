import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { assertPortalOrigin } from "@/lib/auth/host-payout-session";
import { loadWithdrawalEconomy } from "@/lib/db/repositories/withdrawal-economy";
import {
  hostPayoutSummary,
  listHostPayouts,
  manageHostPayout,
  PayoutError,
  payoutDestination,
  portalPayoutRule,
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
function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
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
              ["search", "agency", "country", "status", "from", "to"].includes(
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
    const rows = await listHostPayouts(
      { account },
      filters,
      url.searchParams.has("export") ? 10000 : 200,
    );
    if (url.searchParams.has("export")) {
      const fields = [
        "requestId",
        "hostPublicId",
        "hostName",
        "agencyPublicId",
        "agencyName",
        "country",
        "diamonds",
        "hostUsd",
        "agencyUsd",
        ...(account.role === "MASTER" ? ["companyUsd"] : []),
        "status",
        "requestedAt",
        "approvedAt",
        "paidAt",
        "agencyPaidAt",
        "payoutType",
        "payoutAccount",
        "paymentReference",
        "agencyPaymentReference",
      ];
      const dateKeys = new Set([
        "requestedAt",
        "approvedAt",
        "paidAt",
        "agencyPaidAt",
      ]);
      const format = (v: unknown) =>
        v
          ? new Intl.DateTimeFormat("en-IN", {
              timeZone: "Asia/Kolkata",
              dateStyle: "medium",
              timeStyle: "medium",
            }).format(new Date(String(v))) + " IST"
          : "";
      const text = [
        fields.map(csvCell).join(","),
        ...rows.map((row) =>
          fields
            .map((k) => csvCell(dateKeys.has(k) ? format(row[k]) : row[k]))
            .join(","),
        ),
      ].join("\r\n");
      return new Response(text, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="nazraa-host-payouts-usd.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }
    const rule = portalPayoutRule(await loadWithdrawalEconomy());
    return reply({
      rows,
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
