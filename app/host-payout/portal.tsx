"use client";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
type PayoutData = {
  host: { id: string; name: string };
  availableDiamonds: number;
  estimatedHostUsd: string;
  rule: { slabDiamonds: number; hostUsd: string };
  accounts: {
    id: string;
    type: string;
    displayName: string;
    maskedDestination: string;
  }[];
  history: {
    id: string;
    requestId: string;
    requestedAt: string;
    diamonds: number;
    hostUsd: string;
    status: string;
    paymentReference: string | null;
  }[];
};
type GoogleApi = {
  accounts: {
    id: {
      initialize: (v: {
        client_id: string;
        nonce: string;
        callback: (v: { credential: string }) => void;
        auto_select: boolean;
      }) => void;
      renderButton: (node: HTMLElement, v: object) => void;
    };
  };
};
const dollars = (n: unknown) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(n),
  );
const date = (s: string) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(s)) + " IST";
export default function HostPayoutPortal() {
  const [data, setData] = useState<PayoutData | null>(null),
    [csrf, setCsrf] = useState(""),
    [client, setClient] = useState(""),
    [nonce, setNonce] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState("");
  const button = useRef<HTMLDivElement>(null),
    requestIdentity = useRef<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/host-payout", { cache: "no-store" }),
        v = await r.json();
      if (!r.ok) throw new Error(v.message);
      setData(v.data);
      setCsrf(v.challenge.csrf);
      setNonce(v.challenge.nonce);
      setClient(v.googleClientId);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Host payouts.");
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const action = useCallback(
    async (payload: object) => {
      setBusy(true);
      setError("");
      try {
        const r = await fetch("/api/host-payout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Nazraa-Csrf": csrf,
          },
          body: JSON.stringify(payload),
        });
        const v = await r.json();
        if (!r.ok) throw new Error(v.message);
        return v;
      } finally {
        setBusy(false);
      }
    },
    [csrf],
  );
  useEffect(() => {
    const google = (window as unknown as { google?: GoogleApi }).google;
    if (!ready || !google || !client || !nonce || data || !button.current)
      return;
    google.accounts.id.initialize({
      client_id: client,
      nonce,
      auto_select: false,
      callback: (v) => {
        void action({ action: "login", credential: v.credential })
          .then(() => load())
          .catch((e) => setError(e.message));
      },
    });
    google.accounts.id.renderButton(button.current, {
      theme: "outline",
      size: "large",
      text: "signin_with",
      width: 280,
    });
  }, [ready, client, nonce, data, action, load]);
  async function submit(
    e: React.FormEvent<HTMLFormElement>,
    kind: "account" | "request",
  ) {
    e.preventDefault();
    const form = e.currentTarget,
      f = new FormData(form);
    try {
      if (kind === "request") {
        const storageKey = `nazraa-payout-pending:${data!.host.id}`;
        requestIdentity.current ??=
          sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
        sessionStorage.setItem(storageKey, requestIdentity.current);
        await action({
          action: "request",
          amount: Number(f.get("amount")),
          payoutMethodId: f.get("payoutMethodId"),
          idempotencyKey: requestIdentity.current,
        });
        sessionStorage.removeItem(storageKey);
        requestIdentity.current = null;
        setMessage("Your payout is approved and awaiting payment.");
      } else {
        await action({
          action: "account",
          type: f.get("type"),
          displayName: f.get("displayName"),
          destination: f.get("destination"),
        });
        form.reset();
        setMessage(
          "Payout account updated. Existing requests retain their original account snapshot.",
        );
      }
      await load();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not complete this action. Please retry.",
      );
    }
  }
  return (
    <main className="host-payout">
      <Script
        src="https://accounts.google.com/gsi/client"
        onReady={() => setReady(true)}
        onError={() => setError("Google sign-in could not load. Please retry.")}
        strategy="afterInteractive"
      />
      <header>
        <a href="/">NAZRAA LIVE</a>
        <span>Host Payouts · Secure web portal</span>
        {data && (
          <button
            disabled={busy}
            onClick={() => {
              void action({ action: "logout" })
                .then(load)
                .catch((e) => setError(e.message));
            }}
          >
            Sign out
          </button>
        )}
      </header>
      <section className="portal-intro">
        <p className="eyebrow">HOST PORTAL</p>
        <h1>
          {data
            ? `Welcome, ${data.host.name}`
            : "Your Host payouts, in one place."}
        </h1>
        <p>
          {data
            ? `Nazraa Host ID ${data.host.id}`
            : "Sign in with the same Google account you use in Nazraa. This portal shows only your own payouts; it does not grant Control access."}
        </p>
      </section>
      {error && (
        <p role="alert" className="notice error">
          {error}{" "}
          <button disabled={busy} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!loaded ? (
        <p role="status">Loading your secure portal…</p>
      ) : !data ? (
        <section className="panel">
          <h2>Sign in to Nazraa</h2>
          <div ref={button} />
          {!client && (
            <p>
              Google sign-in is not configured. Contact{" "}
              <a href="mailto:support@nazralive.in">support@nazralive.in</a>.
            </p>
          )}
          <p>
            No new account is created here. Use your existing Host or Agency
            Owner account.
          </p>
        </section>
      ) : (
        <>
          <div className="metrics">
            <section className="panel">
              <small>Available Diamonds</small>
              <strong>{data.availableDiamonds.toLocaleString("en-IN")}</strong>
            </section>
            <section className="panel">
              <small>Applicable Host rate</small>
              <strong>{dollars(data.rule.hostUsd)}</strong>
              <span>
                per {data.rule.slabDiamonds.toLocaleString("en-IN")} Diamonds
              </span>
            </section>
            <section className="panel">
              <small>Eligible estimate</small>
              <strong>{dollars(data.estimatedHostUsd)}</strong>
              <span>Whole configured payout slabs only</span>
            </section>
          </div>
          <div className="portal-columns">
            <section className="panel">
              <h2>Request a payout</h2>
              <p>
                Approved automatically after validation. Approved does not mean
                paid. Diamonds are reserved atomically until payment or an
                authorized reversal.
              </p>
              <form
                onSubmit={(e) => void submit(e, "request")}
                onChange={() => {
                  if (!busy) requestIdentity.current = null;
                }}
              >
                <label>
                  Diamonds
                  <input
                    name="amount"
                    type="number"
                    min={data.rule.slabDiamonds}
                    step={data.rule.slabDiamonds}
                    required
                  />
                </label>
                <label>
                  Payout account
                  <select name="payoutMethodId" required>
                    <option value="">Choose your account</option>
                    {data.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.type} · {a.displayName} · {a.maskedDestination}
                      </option>
                    ))}
                  </select>
                </label>
                <button disabled={busy || !data.accounts.length}>
                  {busy ? "Processing…" : "Request payout"}
                </button>
              </form>
            </section>
            <section className="panel">
              <h2>Payout account</h2>
              {data.accounts.map((a) => (
                <p key={a.id}>
                  {a.displayName} · {a.type} · {a.maskedDestination}
                </p>
              ))}
              <form onSubmit={(e) => void submit(e, "account")}>
                <label>
                  Method
                  <select name="type">
                    <option>BANK</option>
                    <option>UPI</option>
                  </select>
                </label>
                <label>
                  Beneficiary name
                  <input
                    name="displayName"
                    maxLength={120}
                    required
                    autoComplete="name"
                  />
                </label>
                <label>
                  Account details
                  <textarea
                    name="destination"
                    maxLength={190}
                    required
                    placeholder="Bank account number, bank and routing/IFSC details; or your UPI ID"
                  />
                </label>
                <button disabled={busy}>Save account</button>
              </form>
              <small>
                Sensitive details are encrypted. Changes do not rewrite existing
                payout snapshots.
              </small>
            </section>
          </div>
          <section className="panel">
            <h2>Payout history</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Requested · IST</th>
                    <th>Diamonds</th>
                    <th>USD</th>
                    <th>Status</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((p) => (
                    <tr key={p.id}>
                      <td>{p.requestId}</td>
                      <td>{date(p.requestedAt)}</td>
                      <td>{Number(p.diamonds).toLocaleString("en-IN")}</td>
                      <td>{dollars(p.hostUsd)}</td>
                      <td>{p.status === "COMPLETED" ? "PAID" : p.status}</td>
                      <td>{p.paymentReference ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.history.length && <p>No payout requests yet.</p>}
            </div>
          </section>
        </>
      )}
      <footer>
        <a href="/support">Support</a> · <a href="/privacy">Privacy</a> ·{" "}
        <a href="/terms">Terms</a>
      </footer>
      <style jsx>{`
        .host-payout {
          max-width: 1160px;
          margin: auto;
          padding: 28px 20px 60px;
          color: #eee8ff;
        }
        header {
          display: flex;
          gap: 24px;
          align-items: center;
          flex-wrap: wrap;
          border-bottom: 1px solid #423354;
          padding-bottom: 20px;
        }
        header a {
          font-weight: 900;
          color: #eea5da;
          text-decoration: none;
        }
        header span {
          flex: 1;
          color: #c4b8d4;
          font-size: 14px;
        }
        h1 {
          font-size: clamp(30px, 5vw, 48px);
          margin: 8px 0 16px;
        }
        h2 {
          font-size: 21px;
        }
        .portal-intro {
          padding: 32px 0;
        }
        .eyebrow {
          color: #eea5da;
          letter-spacing: 3px;
          font-size: 12px;
          font-weight: 800;
        }
        .panel {
          padding: 24px;
          border: 1px solid #4b385c;
          border-radius: 20px;
          background: #21172e;
          margin-bottom: 20px;
        }
        .metrics,
        .portal-columns {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
        }
        .portal-columns {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .metrics strong {
          display: block;
          font-size: 32px;
          margin: 12px 0;
        }
        .metrics small,
        .metrics span,
        p,
        small {
          color: #c9bfd5;
          line-height: 1.6;
        }
        label {
          display: grid;
          gap: 7px;
          margin: 16px 0;
          font-size: 14px;
        }
        input,
        textarea,
        select {
          width: 100%;
          box-sizing: border-box;
          color: #fff;
          background: #130d1e;
          border: 1px solid #62516f;
          border-radius: 10px;
          padding: 12px;
          font: inherit;
        }
        button {
          background: #d447a5;
          border: 0;
          color: white;
          padding: 12px 20px;
          border-radius: 10px;
          font-weight: 700;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.55;
          cursor: wait;
        }
        .notice {
          padding: 16px;
          border-radius: 12px;
          background: #253e35;
        }
        .error {
          background: #562b3b;
        }
        .table-scroll {
          overflow: auto;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          text-align: left;
          font-size: 13px;
        }
        th,
        td {
          padding: 14px 10px;
          border-bottom: 1px solid #473750;
          white-space: nowrap;
        }
        th {
          color: #efbddd;
        }
        footer {
          margin-top: 30px;
          color: #c9bfd5;
        }
        a {
          color: #efbddd;
        }
        @media (max-width: 700px) {
          .metrics,
          .portal-columns {
            grid-template-columns: 1fr;
          }
          .panel {
            padding: 20px;
          }
          .metrics strong {
            font-size: 28px;
          }
        }
      `}</style>
    </main>
  );
}
