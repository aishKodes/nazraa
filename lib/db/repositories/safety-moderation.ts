import "server-only";

import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { can } from "@/lib/auth/permissions";
import { monitoringScopeWhere } from "@/lib/db/repositories/accounts";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { Scope } from "@/types/platform";

export type SafetyReportStatus = "NEW" | "UNDER_REVIEW" | "ACTIONED" | "DISMISSED";

export async function listSafetyReports(scope: Scope, input: { status: SafetyReportStatus; page: number }) {
  if (!can(scope.account.role, "risk.read")) throw new Error("Your role cannot view safety reports.");
  const targetScope = monitoringScopeWhere(scope, "target_user.agency_account_id");
  const reporterScope = monitoringScopeWhere(scope, "reporter.agency_account_id");
  const scopedClause = scope.isGlobal || scope.account.role === "MONITORING_CS"
    ? "1=1"
    : `((${targetScope.clause}) OR (${reporterScope.clause}))`;
  const scopedValues = scope.isGlobal || scope.account.role === "MONITORING_CS"
    ? []
    : [...targetScope.values, ...reporterScope.values];
  const offset = (Math.max(1, input.page) - 1) * 25;
  const [rows] = await db().query<RowDataPacket[]>(
    `SELECT report.id, report.report_type, report.reason_code, report.reason_detail,
            report.severity, report.status, report.evidence_metadata, report.created_at,
            reporter.public_id reporter_public_id, reporter.full_name reporter_name,
            target_user.public_id target_public_id, target_user.full_name target_name,
            room.room_code, report.content_id, report.message_id,
            assignee.full_name assigned_name, actor.full_name actioned_name,
            report.action_note, report.actioned_at
     FROM safety_reports report
     INNER JOIN application_users reporter ON reporter.id = report.reporter_application_user_id
     LEFT JOIN application_users target_user ON target_user.id = report.target_application_user_id
     LEFT JOIN live_rooms room ON room.id = report.room_id
     LEFT JOIN platform_accounts assignee ON assignee.id = report.assigned_to
     LEFT JOIN platform_accounts actor ON actor.id = report.actioned_by
     WHERE report.status = ? AND ${scopedClause}
     ORDER BY FIELD(report.severity, 'CRITICAL', 'HIGH', 'NORMAL'), report.created_at ASC
     LIMIT 26 OFFSET ?`,
    [input.status, ...scopedValues, offset],
  );
  return rows.map((row) => ({
    id: String(row.id),
    reportType: String(row.report_type),
    reasonCode: String(row.reason_code),
    reasonDetail: row.reason_detail == null ? null : String(row.reason_detail),
    severity: String(row.severity),
    status: String(row.status),
    createdAt: row.created_at,
    reporterPublicId: String(row.reporter_public_id),
    reporterName: String(row.reporter_name),
    targetPublicId: row.target_public_id == null ? null : String(row.target_public_id),
    targetName: row.target_name == null ? null : String(row.target_name),
    roomCode: row.room_code == null ? null : String(row.room_code),
    contentId: row.content_id == null ? null : String(row.content_id),
    messageId: row.message_id == null ? null : String(row.message_id),
    assignedName: row.assigned_name == null ? null : String(row.assigned_name),
    actionedName: row.actioned_name == null ? null : String(row.actioned_name),
    actionNote: row.action_note == null ? null : String(row.action_note),
    actionedAt: row.actioned_at,
  }));
}

export async function updateSafetyReport(input: {
  scope: Scope;
  reportId: string;
  status: SafetyReportStatus;
  note: string;
}) {
  if (!can(input.scope.account.role, "risk.manage")) throw new Error("Your role cannot manage safety reports.");
  const targetScope = monitoringScopeWhere(input.scope, "target_user.agency_account_id");
  const reporterScope = monitoringScopeWhere(input.scope, "reporter.agency_account_id");
  const scopedClause = input.scope.isGlobal || input.scope.account.role === "MONITORING_CS"
    ? "1=1"
    : `((${targetScope.clause}) OR (${reporterScope.clause}))`;
  const scopedValues = input.scope.isGlobal || input.scope.account.role === "MONITORING_CS"
    ? []
    : [...targetScope.values, ...reporterScope.values];
  return withTransaction(async (connection) => {
    const [rows] = await connection.query<(RowDataPacket & { id: string; status: SafetyReportStatus })[]>(
      `SELECT report.id, report.status
       FROM safety_reports report
       INNER JOIN application_users reporter ON reporter.id = report.reporter_application_user_id
       LEFT JOIN application_users target_user ON target_user.id = report.target_application_user_id
       WHERE report.id = ? AND ${scopedClause} LIMIT 1 FOR UPDATE`,
      [input.reportId, ...scopedValues],
    );
    const report = rows[0];
    if (!report) throw new Error("This safety report is outside your review scope or no longer exists.");
    const completed = input.status === "ACTIONED" || input.status === "DISMISSED";
    await connection.execute(
      `UPDATE safety_reports
       SET status = ?, assigned_to = ?, action_note = ?,
           actioned_by = ?, actioned_at = ${completed ? "CURRENT_TIMESTAMP(3)" : "NULL"}
       WHERE id = ?`,
      [input.status, input.scope.account.id, input.note.trim(), completed ? input.scope.account.id : null, report.id],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'safety_report.status_update', 'moderation', 'safety_report', ?, ?, ?, ?)`,
      [randomUUID(), input.scope.account.id, input.scope.account.role, report.id,
        JSON.stringify({ status: report.status }), JSON.stringify({ status: input.status }), input.note.trim()],
    );
    return { id: report.id, status: input.status };
  });
}
