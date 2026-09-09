import "server-only";

import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import type { Scope } from "@/types/platform";

export type ManagedLevelTrack = "CONSUMPTION" | "ANCHOR_INCOME";

export type ManagedLevelDefinition = {
  track: ManagedLevelTrack;
  level: number;
  threshold: number;
  badgeKey: string;
  label: string;
  enabled: boolean;
};

export async function managedLevelDefinitions(track: ManagedLevelTrack) {
  const [rows] = await db().query<(RowDataPacket & {
    track: ManagedLevelTrack;
    level_number: number;
    points_required: number;
    badge_key: string;
    level_label: string;
    enabled: number;
  })[]>(
    `SELECT track, level_number, points_required, badge_key, level_label, enabled
     FROM level_definitions WHERE track = ? ORDER BY level_number`,
    [track],
  );
  return rows.map((row) => ({
    track: row.track,
    level: Number(row.level_number),
    threshold: Number(row.points_required),
    badgeKey: String(row.badge_key),
    label: String(row.level_label),
    enabled: Boolean(row.enabled),
  }));
}

export async function saveManagedLevelDefinitions(input: {
  scope: Scope;
  track: ManagedLevelTrack;
  definitions: ManagedLevelDefinition[];
  reason: string;
}) {
  if (input.scope.account.role !== "MASTER") {
    throw new Error("Only Master can change level progression.");
  }
  if (input.reason.trim().length < 5 || input.reason.trim().length > 500) {
    throw new Error("Enter a clear reason for this progression change.");
  }
  if (input.definitions.length === 0) throw new Error("No level definitions were provided.");

  await withTransaction(async (connection) => {
    const [existingRows] = await connection.query<(RowDataPacket & {
      level_number: number;
      points_required: number;
      badge_key: string;
      level_label: string;
      enabled: number;
    })[]>(
      `SELECT level_number, points_required, badge_key, level_label, enabled
       FROM level_definitions WHERE track = ? ORDER BY level_number FOR UPDATE`,
      [input.track],
    );
    const merged = new Map(existingRows.map((row) => [Number(row.level_number), {
      track: input.track,
      level: Number(row.level_number),
      threshold: Number(row.points_required),
      badgeKey: String(row.badge_key),
      label: String(row.level_label),
      enabled: Boolean(row.enabled),
    }]));
    for (const definition of input.definitions) {
      if (definition.track !== input.track || !Number.isInteger(definition.level) || definition.level < 1 || definition.level > 200) {
        throw new Error("Each level must belong to the selected track and be between 1 and 200.");
      }
      if (!Number.isSafeInteger(definition.threshold) || definition.threshold < 0) {
        throw new Error(`Level ${definition.level} needs a valid whole-number cumulative threshold.`);
      }
      if (!/^[a-z0-9_-]{2,40}$/i.test(definition.badgeKey)) {
        throw new Error(`Level ${definition.level} needs a simple badge key (letters, numbers, _ or -).`);
      }
      if (definition.label.trim().length < 2 || definition.label.trim().length > 40) {
        throw new Error(`Level ${definition.level} needs a label between 2 and 40 characters.`);
      }
      merged.set(definition.level, { ...definition, label: definition.label.trim() });
    }

    const complete = [...merged.values()].sort((left, right) => left.level - right.level);
    let previousThreshold = -1;
    for (const definition of complete) {
      if (definition.threshold <= previousThreshold) {
        throw new Error("Cumulative thresholds must strictly increase for every level.");
      }
      previousThreshold = definition.threshold;
    }

    const previous = existingRows.map((row) => ({
      level: Number(row.level_number),
      threshold: Number(row.points_required),
      badgeKey: String(row.badge_key),
      label: String(row.level_label),
      enabled: Boolean(row.enabled),
    }));
    for (const definition of input.definitions) {
      await connection.execute(
        `UPDATE level_definitions
         SET points_required = ?, badge_key = ?, level_label = ?, enabled = ?
         WHERE track = ? AND level_number = ?`,
        [definition.threshold, definition.badgeKey, definition.label.trim(), definition.enabled, input.track, definition.level],
      );
    }
    await connection.execute(
      `INSERT INTO audit_logs
        (id, actor_account_id, actor_role, action, module, target_type, target_id, previous_data, new_data, reason)
       VALUES (?, ?, ?, 'levels.update', 'levels', 'level_track', ?, ?, ?, ?)`,
      [
        randomUUID(), input.scope.account.id, input.scope.account.role, input.track,
        JSON.stringify(previous),
        JSON.stringify(input.definitions),
        input.reason.trim(),
      ],
    );
  });
}
