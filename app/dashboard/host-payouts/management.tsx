"use client";
import { useCallback, useEffect, useState } from "react";
import { payoutJsonRequest, payoutUiMessage } from "@/lib/client/payout-request";
type Row = {
  id: string;
  requestId: string;
  hostId: string;
  hostPublicId: string;
  hostName: string;
  agencyPublicId: string;
  agencyName: string;
  country: string;
  diamonds: number;
  hostUsd: string;
  agencyUsd: string;
  companyUsd?: string;
  status: string;
  requestedAt: string;
  approvedAt: string;
  paidAt: string | null;
  agencyPaidAt: string | null;
  agencyReversedAt: string | null;
  payoutType: string;
  payoutAccount: string;
  paymentReference: string | null;
  note: string | null;
  rule: object;
};
type Data = {
  rows: Row[];
  summary: Record<string, number>;
  isMaster: boolean;
  rule: {
    slabDiamonds: number;
    totalUsd: string;
    hostUsd: string;
    agencyUsd: string;
    companyUsd: string;
  };
};
const dollars = (n: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(n),
  );
const date = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(s)) + " IST"
    : "—";
export default function PayoutManagement() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [destination, setDestination] = useState(""),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const v = await payoutJsonRequest<Data>(`/api/host-payout-management?${query}`, {
          cache: "no-store",
        }, "Could not load payouts. Please retry.");
      setData(v);
    } catch (e) {
      setError(payoutUiMessage(e, "Could not load payouts. Please retry."));
    }
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);
  async function mutate(payload: object) {
    setBusy(true);
    setError("");
    try {
      await payoutJsonRequest("/api/host-payout-management", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }, "Could not save payout. Please retry.");
      setNotice("Saved. Accounting snapshot and audit history preserved.");
      await load();
      setSelected(null);
      setDestination("");
    } catch (e) {
      setError(payoutUiMessage(e, "Could not save payout. Please retry."));
    } finally {
      setBusy(false);
    }
  }
  const cards = [
    ["Total requested", "requestedUsd"],
    ["Host payout paid", "paidUsd"],
    ["Approved / awaiting payment", "awaitingUsd"],
    ["Failed / reversed", "failedOrReversed"],
    ["Diamonds withdrawn", "diamondsWithdrawn"],
    ["Agency commission accrued", "agencyAccruedUsd"],
    ["Agency commission paid", "agencyPaidUsd"],
    ["Agency commission outstanding", "agencyOutstandingUsd"],
    ...(data?.isMaster
      ? [["Company retained (paid)", "companyRetainedUsd"]]
      : []),
  ];
  return (
    <section>
      <div className="page-heading">
        <div>
          <h1>Host Payouts</h1>
          <p>
            Web auto-approved requests · USD accounting · business timestamps in
            IST
          </p>
        </div>
        <a href="/host-payout" target="_blank" rel="noreferrer">
          Host portal ↗
        </a>
      </div>
      {error && (
        <p role="alert">
          {error} <button onClick={() => void load()}>Retry</button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className="payout-cards">
        {cards.map(([title, key]) => (
          <article className="panel" key={key}>
            <small>{title}</small>
            <h2>
              {!data
                ? error
                  ? "Unavailable"
                  : "Loading…"
                : key.endsWith("Usd")
                  ? dollars(data.summary[key] ?? 0)
                  : Number(data.summary[key] ?? 0).toLocaleString("en-IN")}
            </h2>
          </article>
        ))}
      </div>
      <form
        className="panel filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setQuery(
            new URLSearchParams(
              [...f.entries()]
                .filter(([, v]) => String(v))
                .map(([k, v]) => [k, String(v)]),
            ).toString(),
          );
        }}
      >
        <label>
          Host ID / name / payout
          <input name="search" maxLength={100} />
        </label>
        <label>
          Agency ID / name
          <input name="agency" maxLength={100} />
        </label>
        <label>
          Country code
          <input
            name="country"
            maxLength={2}
            pattern="[A-Z]{2}"
            placeholder="IN"
          />
        </label>
        <label>
          Status
          <select name="status">
            <option value="">All</option>
            <option>APPROVED</option>
            <option value="COMPLETED">PAID</option>
            <option>FAILED</option>
            <option>REVERSED</option>
          </select>
        </label>
        <label>
          From · IST
          <input name="from" type="date" />
        </label>
        <label>
          To · IST
          <input name="to" type="date" />
        </label>
        <button>Filter</button>
        <a href={`/api/host-payout-management?${query}&export=1`}>
          Export USD CSV
        </a>
      </form>
      <div className="panel scroll">
        <table>
          <thead>
            <tr>
              <th>Host / Agency</th>
              <th>Request · IST</th>
              <th>Diamonds</th>
              <th>Host USD</th>
              <th>Agency USD</th>
              {data?.isMaster && <th>Company USD</th>}
              <th>Status</th>
              <th>Payment</th>
              {data?.isMaster && <th>Manage</th>}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.hostName} · {r.hostPublicId}
                  <br />
                  <small>
                    {r.country} → {r.agencyName ?? "Unassigned"} ·{" "}
                    {r.agencyPublicId ?? "—"}
                  </small>
                </td>
                <td>
                  {r.requestId}
                  <br />
                  {date(r.requestedAt)}
                </td>
                <td>{Number(r.diamonds).toLocaleString("en-IN")}</td>
                <td>{dollars(r.hostUsd)}</td>
                <td>
                  {dollars(r.agencyUsd)}
                  <br />
                  <small>
                    {r.agencyReversedAt
                      ? `Reversed ${date(r.agencyReversedAt)}`
                      : r.agencyPaidAt
                        ? `Paid ${date(r.agencyPaidAt)}`
                        : "Not paid"}
                  </small>
                </td>
                {data.isMaster && <td>{dollars(r.companyUsd)}</td>}
                <td>{r.status === "COMPLETED" ? "PAID" : r.status}</td>
                <td>
                  {r.payoutType} · {r.payoutAccount}
                  <br />
                  {r.paymentReference ?? "—"}
                  <br />
                  {date(r.paidAt)}
                </td>
                {data.isMaster && (
                  <td>
                    <button
                      onClick={() => {
                        setSelected(r);
                        setDestination("");
                      }}
                    >
                      Manage
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.rows.length && <p>No payouts match this scope.</p>}
      </div>
      {selected && data?.isMaster && (
        <section className="panel">
          <h2>
            {selected.requestId} · {selected.hostName}
          </h2>
          <p>
            Approved {date(selected.approvedAt)}. Financial
            amount/rate/destination snapshots are immutable.
          </p>
          <pre>{JSON.stringify(selected.rule, null, 2)}</pre>
          <button
            disabled={busy}
            onClick={() => {
              void payoutJsonRequest<{ destination: string }>(
                `/api/host-payout-management?destination=${selected.id}`,
                { cache: "no-store" },
                "Could not load the secure account. Please retry.",
              )
                .then((v) => {
                  setDestination(v.destination);
                })
                .catch((e) => setError(payoutUiMessage(e, "Could not load the secure account. Please retry.")));
            }}
          >
            View secure account snapshot
          </button>
          {destination && <pre>{destination}</pre>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate({
                id: selected.id,
                action: f.get("action"),
                reason: f.get("reason"),
                reference: f.get("reference") || undefined,
              });
            }}
          >
            <label>
              Action
              <select name="action">
                <option value="note">Correct reference / add note</option>
                {["APPROVED", "PROCESSING"].includes(selected.status) && (
                  <>
                    <option value="paid">Mark Host paid</option>
                    <option value="failed">Failed · restore Diamonds</option>
                    <option value="reverse">Reverse · restore Diamonds</option>
                  </>
                )}
                {selected.status === "COMPLETED" && (
                  <>
                    <option value="reverse">Reverse paid payout</option>
                    {!selected.agencyPaidAt &&
                      Number(selected.agencyUsd) > 0 && (
                        <option value="agency-paid">
                          Mark Agency commission paid
                        </option>
                      )}
                    {selected.agencyPaidAt && !selected.agencyReversedAt && (
                      <option value="agency-reverse">
                        Record Agency payment reversal
                      </option>
                    )}
                  </>
                )}
              </select>
            </label>
            <label>
              Payment reference
              <input
                name="reference"
                maxLength={255}
                defaultValue={selected.paymentReference ?? ""}
              />
            </label>
            <label>
              Reason / note
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
            <button disabled={busy}>Save audited action</button>
          </form>
          <h3>Update Host payout account for future requests</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate({
                action: "account",
                hostId: selected.hostId,
                type: f.get("type"),
                displayName: f.get("displayName"),
                destination: f.get("destination"),
              });
            }}
          >
            <label>
              Method
              <select name="type">
                <option>BANK</option>
                <option>UPI</option>
              </select>
            </label>
            <label>
              Beneficiary
              <input name="displayName" required maxLength={120} />
            </label>
            <label>
              Destination
              <textarea name="destination" required maxLength={190} />
            </label>
            <button disabled={busy}>Save account version</button>
          </form>
          <button
            onClick={() => {
              setSelected(null);
              setDestination("");
            }}
          >
            Close
          </button>
        </section>
      )}
      {data?.isMaster && (
        <section className="panel">
          <h2>Payout rules · future requests only</h2>
          <p>
            New workflow: Host + Agency; all remainder belongs to Company (
            {dollars(data.rule.companyUsd)} per slab). No other role receives an
            automatic entitlement here.
          </p>
          <form
            key={JSON.stringify(data.rule)}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate({
                action: "rule",
                slabDiamonds: Number(f.get("slabDiamonds")),
                totalUsd: f.get("totalUsd"),
                hostUsd: f.get("hostUsd"),
                agencyUsd: f.get("agencyUsd"),
                reason: f.get("reason"),
              });
            }}
          >
            <label>
              Diamond slab
              <input
                name="slabDiamonds"
                type="number"
                min={1}
                defaultValue={data.rule.slabDiamonds}
                required
              />
            </label>
            {(["totalUsd", "hostUsd", "agencyUsd"] as const).map((k) => (
              <label key={k}>
                {k === "totalUsd"
                  ? "Total value USD"
                  : k === "hostUsd"
                    ? "Host USD"
                    : "Agency USD"}
                <input
                  name={k}
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={data.rule[k]}
                  required
                />
              </label>
            ))}
            <label>
              Change reason
              <textarea name="reason" required minLength={3} maxLength={500} />
            </label>
            <button disabled={busy}>Save rules</button>
          </form>
        </section>
      )}
      <style jsx>{`
        .payout-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 14px;
        }
        .panel {
          padding: 20px;
          margin-bottom: 16px;
        }
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: end;
        }
        .scroll {
          overflow: auto;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        td,
        th {
          text-align: left;
          padding: 13px;
          border-bottom: 1px solid #ddd;
          vertical-align: top;
          white-space: nowrap;
        }
        label {
          display: grid;
          gap: 6px;
          margin: 12px 0;
        }
        input,
        select,
        textarea {
          padding: 9px;
          max-width: 100%;
          border: 1px solid #aaa;
          border-radius: 7px;
        }
        button {
          padding: 9px 14px;
          border-radius: 7px;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.5;
        }
        pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        small {
          opacity: 0.8;
        }
      `}</style>
    </section>
  );
}
