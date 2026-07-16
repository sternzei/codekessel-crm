import { asc } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { participants } from "@/db/schema";

export type ParticipantStatus =
  (typeof participants.status.enumValues)[number];

export type PipelineEntry = {
  id: string;
  firstName: string;
  lastName: string;
  status: ParticipantStatus;
  availabilityStatus: string;
  city: string | null;
};

export const PIPELINE_STATUS_ORDER: ParticipantStatus[] =
  participants.status.enumValues;

export async function listPipeline(tx: DbHandle): Promise<PipelineEntry[]> {
  return tx
    .select({
      id: participants.id,
      firstName: participants.firstName,
      lastName: participants.lastName,
      status: participants.status,
      availabilityStatus: participants.availabilityStatus,
      city: participants.city,
    })
    .from(participants)
    .orderBy(asc(participants.createdAt));
}
