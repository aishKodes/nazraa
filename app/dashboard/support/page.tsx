import { MessageSquareText } from "lucide-react";
import { submitSupportUpdate } from "@/app/admin-actions";
import { Card, EmptyState, Notice, SectionHeading, StatusBadge } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/guard";
import { listSupportTickets } from "@/lib/db/repositories/catalog";
import { formatDate } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const scope = await requirePermission("support.read"); const { error, success } = await searchParams; const tickets = await listSupportTickets(scope); const manage = can(scope.account.role, "support.manage");
  return <><SectionHeading title="Support" description="User tickets, assignment, replies, and internal notes. Support actions never change balances." />{success ? <Notice type="success">{success}</Notice> : null}{error ? <Notice type="error">{error}</Notice> : null}
    <Card>{tickets.length ? <div className="table-scroll"><table><thead><tr><th>Ticket</th><th>User</th><th>Category</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Updated</th>{manage ? <th>Reply</th> : null}</tr></thead><tbody>{tickets.map((ticket) => <tr key={ticket.id}><td><b>{ticket.subject}</b><small className="mono block">{ticket.code}</small></td><td>{ticket.userName ? <><b>{ticket.userName}</b><small className="mono block">{ticket.externalUserId}</small></> : "Unknown user"}</td><td>{ticket.category}</td><td><StatusBadge value={ticket.priority} /></td><td><StatusBadge value={ticket.status} /></td><td>{ticket.assignee ?? "Unassigned"}</td><td>{formatDate(ticket.updatedAt)}</td>{manage ? <td><details className="row-action"><summary>Open thread</summary><div className="ticket-thread">{ticket.messages.map((message) => <div key={message.id}><b>{message.internalNote ? "Internal note" : message.senderType.replaceAll("_", " ")}</b><p>{message.message}</p><small>{formatDate(message.createdAt)}</small></div>)}</div><form action={submitSupportUpdate} className="ticket-form"><input type="hidden" name="ticketId" value={ticket.id} /><select name="status" defaultValue={ticket.status}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="WAITING_USER">Waiting user</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></select><textarea name="message" required rows={3} placeholder="Reply or internal note" /><label className="checkbox-line"><input type="checkbox" name="internalNote" value="true" />Internal note</label><button className="primary-button" type="submit">Save update</button></form></details></td> : null}</tr>)}</tbody></table></div> : <EmptyState title="No support tickets" detail="Tickets created by the mobile API will appear here for the support team." />}</Card><p className="footnote"><MessageSquareText size={14} />Replies and notes are stored in the ticket thread; financial actions are unavailable here.</p>
  </>;
}
