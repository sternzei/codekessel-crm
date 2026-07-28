import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { DbHandle } from "@/db/client";
import * as schema from "@/db/schema";
import {
  activityLog,
  appointments,
  messageDeliveries,
  outboundMessages,
  participants,
  tasks,
  tenants,
  users,
} from "@/db/schema";
import { resolveActiveSessionUser } from "@/modules/auth/current-user";
import { resolveParticipantWriteAccess } from "@/modules/auth/participant-scope";
import { resolveTaskWriteAccess } from "@/modules/auth/task-scope";
import {
  approveAndDispatch,
  cancelOutboundMessage,
  listPendingMessages,
  rejectOutboundMessage,
} from "@/modules/messaging/outbox";
import { listPipelineForExport } from "@/modules/participants/pipeline";
import { computeReports } from "@/modules/reports/metrics";
import type {
  ChannelAdapter,
  SendResult,
} from "@/modules/messaging/types";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is required");

// PostgreSQL READ COMMITTED is sufficient: each UPDATE rechecks its status
// predicate after waiting on a concurrent row lock, so only one CAS can return.
test("concurrent approvals dispatch exactly once and claims are compare-and-set", async () => {
  const client = postgres(databaseUrl, { max: 5 });
  const database = drizzle(client, { schema });
  const appDatabaseUrl = process.env.DATABASE_URL;
  if (!appDatabaseUrl) throw new Error("DATABASE_URL is required");
  const appClient = postgres(appDatabaseUrl, { max: 5, prepare: false });
  const appDatabase = drizzle(appClient, { schema });
  const runWithTenant = <T>(
    scopedTenantId: string,
    operation: (tx: DbHandle) => Promise<T>,
  ): Promise<T> =>
    appDatabase.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${scopedTenantId}, true)`,
      );
      return operation(tx);
    });
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const creatorId = randomUUID();
  const approverOneId = randomUUID();
  const approverTwoId = randomUUID();
  const participantId = randomUUID();
  const unassignedParticipantId = randomUUID();
  const otherConsultantParticipantId = randomUUID();
  const crossTenantParticipantId = randomUUID();
  let sendCount = 0;
  const adapter: ChannelAdapter = {
    channel: "whatsapp",
    async send(): Promise<SendResult> {
      sendCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { ok: true, providerMessageId: `provider-${sendCount}` };
    },
  };
  try {
    await database.insert(tenants).values({ id: tenantId, name: "CRM P0 Test" });
    await database
      .insert(tenants)
      .values({ id: otherTenantId, name: "CRM P0 Other Tenant" });
    await database.insert(users).values([
      {
        id: creatorId,
        tenantId,
        email: `${creatorId}@test.invalid`,
        name: "Creator",
        role: "consultant",
      },
      {
        id: approverOneId,
        tenantId,
        email: `${approverOneId}@test.invalid`,
        name: "Manager One",
        role: "manager",
      },
      {
        id: approverTwoId,
        tenantId,
        email: `${approverTwoId}@test.invalid`,
        name: "Manager Two",
        role: "manager",
      },
    ]);
    await database.insert(participants).values([
      {
        id: participantId,
        tenantId,
        firstName: "Pool",
        lastName: "Lead",
      },
      {
        id: unassignedParticipantId,
        tenantId,
        firstName: "Unassigned",
        lastName: "Visible",
      },
      {
        id: otherConsultantParticipantId,
        tenantId,
        firstName: "Other",
        lastName: "Hidden",
        assignedConsultantId: approverTwoId,
      },
      {
        id: crossTenantParticipantId,
        tenantId: otherTenantId,
        firstName: "Cross",
        lastName: "Tenant",
      },
    ]);
    const [poolTask] = await database
      .insert(tasks)
      .values({
        tenantId,
        type: "integration_pool_task",
        title: "Pool task",
        ownerKind: "participant",
        ownerParticipantId: unassignedParticipantId,
        subjectKind: "participant",
        subjectId: unassignedParticipantId,
      })
      .returning({ id: tasks.id });
    await database.insert(appointments).values({
      tenantId,
      participantId: otherConsultantParticipantId,
      consultantId: approverOneId,
      scheduledAt: new Date("2026-07-28T09:00:00.000Z"),
    });
    const poolWriteBeforeClaim = await runWithTenant(tenantId, (tx) =>
      resolveParticipantWriteAccess(tx, unassignedParticipantId, {
        userId: approverOneId,
        role: "consultant",
      }),
    );
    const taskWriteBeforeClaim = await runWithTenant(tenantId, (tx) =>
      resolveTaskWriteAccess(tx, poolTask.id, {
        userId: approverOneId,
        role: "consultant",
      }),
    );
    assert.equal(poolWriteBeforeClaim, "must_claim");
    assert.equal(taskWriteBeforeClaim, "must_claim");
    await database
      .update(participants)
      .set({ assignedConsultantId: approverOneId })
      .where(eq(participants.id, unassignedParticipantId));
    assert.equal(
      await runWithTenant(tenantId, (tx) =>
        resolveTaskWriteAccess(tx, poolTask.id, {
          userId: approverOneId,
          role: "consultant",
        }),
      ),
      "allowed",
    );
    const historicalReports = await runWithTenant(tenantId, (tx) =>
      computeReports(
        tx,
        { consultantId: approverOneId },
        { userId: approverTwoId, role: "manager" },
      ),
    );
    assert.equal(
      historicalReports.totalAppointments,
      1,
      "appointment attribution survives participant reassignment",
    );
    const [message] = await database
      .insert(outboundMessages)
      .values({
        tenantId,
        createdByUserId: creatorId,
        channel: "whatsapp",
        templateKey: "integration_test",
        recipientKind: "participant",
        recipientId: participantId,
        recipientPhone: "491511234567",
        recipientName: "Pool Lead",
        body: "Harmless integration test",
      })
      .returning({ id: outboundMessages.id });
    const consultantDenied = await approveAndDispatch({
      tenantId,
      messageId: message.id,
      approvedByUserId: creatorId,
      approverRole: "consultant",
      adapter,
      runWithTenant,
    });
    assert.equal(consultantDenied, "forbidden_role");
    const selfApprovalDenied = await approveAndDispatch({
      tenantId,
      messageId: message.id,
      approvedByUserId: creatorId,
      approverRole: "manager",
      adapter,
      runWithTenant,
    });
    assert.equal(selfApprovalDenied, "self_approval");
    assert.equal(sendCount, 0);
    const outcomes = await Promise.all([
      approveAndDispatch({
        tenantId,
        messageId: message.id,
        approvedByUserId: approverOneId,
        approverRole: "manager",
        adapter,
        runWithTenant,
      }),
      approveAndDispatch({
        tenantId,
        messageId: message.id,
        approvedByUserId: approverTwoId,
        approverRole: "manager",
        adapter,
        runWithTenant,
      }),
    ]);
    assert.deepEqual([...outcomes].sort(), ["dispatched", "not_pending"]);
    assert.equal(sendCount, 1);

    const [terminalMessage] = await database
      .insert(outboundMessages)
      .values({
        tenantId,
        createdByUserId: creatorId,
        channel: "whatsapp",
        templateKey: "terminal_race",
        recipientKind: "participant",
        recipientId: participantId,
        body: "Terminal race",
      })
      .returning({ id: outboundMessages.id });
    const terminalOutcomes = await Promise.all([
      runWithTenant(tenantId, (tx) =>
        rejectOutboundMessage(tx, {
          tenantId,
          messageId: terminalMessage.id,
          rejectedByUserId: approverOneId,
          rejectorRole: "manager",
        }),
      ),
      runWithTenant(tenantId, (tx) =>
        cancelOutboundMessage(tx, {
          tenantId,
          messageId: terminalMessage.id,
          cancelledByUserId: approverTwoId,
          cancellerRole: "manager",
        }),
      ),
    ]);
    assert.equal(
      terminalOutcomes.filter(
        (outcome) => outcome === "rejected" || outcome === "cancelled",
      ).length,
      1,
    );
    const terminalEvents = await database
      .select({ event: activityLog.event })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.subjectId, terminalMessage.id),
          inArray(activityLog.event, ["message_rejected", "message_cancelled"]),
        ),
      );
    assert.equal(terminalEvents.length, 1);

    const [staleRoleMessage] = await database
      .insert(outboundMessages)
      .values({
        tenantId,
        createdByUserId: creatorId,
        channel: "whatsapp",
        templateKey: "stale_role",
        recipientKind: "participant",
        recipientId: participantId,
        body: "Must not dispatch",
      })
      .returning({ id: outboundMessages.id });
    await database
      .update(users)
      .set({ role: "consultant" })
      .where(eq(users.id, approverOneId));
    const freshUser = await runWithTenant(tenantId, (tx) =>
      resolveActiveSessionUser(tx, {
        id: approverOneId,
        tenantId,
      }),
    );
    assert.equal(freshUser?.role, "consultant");
    const staleRoleOutcome = await approveAndDispatch({
      tenantId,
      messageId: staleRoleMessage.id,
      approvedByUserId: approverOneId,
      approverRole: freshUser?.role ?? "consultant",
      adapter,
      runWithTenant,
    });
    assert.equal(staleRoleOutcome, "forbidden_role");
    assert.equal(sendCount, 1);
    await database
      .update(users)
      .set({ role: "manager" })
      .where(eq(users.id, approverOneId));

    const systemRows = await database
      .insert(outboundMessages)
      .values([
        {
          tenantId,
          taskId: poolTask.id,
          channel: "whatsapp",
          templateKey: "system_task",
          recipientKind: "participant",
          recipientId: unassignedParticipantId,
          body: "Visible system task",
        },
        {
          tenantId,
          channel: "whatsapp",
          templateKey: "system_global",
          recipientKind: "participant",
          recipientId: participantId,
          body: "Hidden tenant-wide system message",
        },
      ])
      .returning({ id: outboundMessages.id, taskId: outboundMessages.taskId });
    const consultantOutbox = await runWithTenant(tenantId, (tx) =>
      listPendingMessages(tx, {
        userId: approverOneId,
        role: "consultant",
      }),
    );
    const scopedSystemMessage = systemRows.find((row) => row.taskId !== null);
    const globalSystemMessage = systemRows.find((row) => row.taskId === null);
    assert.equal(
      consultantOutbox.some((row) => row.id === scopedSystemMessage?.id),
      true,
    );
    assert.equal(
      consultantOutbox.some((row) => row.id === globalSystemMessage?.id),
      false,
    );

    const claim = (userId: string) =>
      database
        .update(participants)
        .set({ assignedConsultantId: userId })
        .where(
          and(
            eq(participants.id, participantId),
            eq(participants.tenantId, tenantId),
            isNull(participants.assignedConsultantId),
          ),
        )
        .returning({ id: participants.id });
    const claims = await Promise.all([
      claim(approverOneId),
      claim(approverTwoId),
    ]);
    assert.equal(claims.filter((rows) => rows.length === 1).length, 1);
    const visibleRows = await appDatabase.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.tenant_id', ${tenantId}, true)`,
      );
      return listPipelineForExport(
        tx,
        { statuses: [], consultantId: approverTwoId },
        { userId: approverOneId, role: "consultant" },
      );
    });
    assert.equal(
      visibleRows.some((row) => row.firstName === "Unassigned"),
      true,
    );
    assert.equal(
      visibleRows.some((row) => row.firstName === "Other"),
      false,
    );
    assert.equal(
      visibleRows.some((row) => row.firstName === "Cross"),
      false,
    );
  } finally {
    await database
      .delete(messageDeliveries)
      .where(eq(messageDeliveries.tenantId, tenantId));
    await database
      .delete(activityLog)
      .where(eq(activityLog.tenantId, tenantId));
    await database
      .delete(outboundMessages)
      .where(eq(outboundMessages.tenantId, tenantId));
    await database
      .delete(appointments)
      .where(eq(appointments.tenantId, tenantId));
    await database.delete(tasks).where(eq(tasks.tenantId, tenantId));
    await database
      .delete(participants)
      .where(
        sql`${participants.tenantId} in (${tenantId}, ${otherTenantId})`,
      );
    await database.delete(users).where(eq(users.tenantId, tenantId));
    await database.delete(tenants).where(eq(tenants.id, tenantId));
    await database.delete(tenants).where(eq(tenants.id, otherTenantId));
    await appClient.end();
    await client.end();
  }
});
