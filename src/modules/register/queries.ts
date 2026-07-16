import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers } from "@/db/schema";

/**
 * Which of the given OpenRegister company ids are already imported for this
 * tenant — powers the "bereits importiert" dedup badge on the import page.
 */
export async function listImportedRegisterIds(
  tx: DbHandle,
  tenantId: string,
  companyIds: string[],
): Promise<Set<string>> {
  if (companyIds.length === 0) return new Set();
  const rows = await tx
    .select({ registerId: employers.registerId })
    .from(employers)
    .where(
      and(
        eq(employers.tenantId, tenantId),
        isNotNull(employers.registerId),
        inArray(employers.registerId, companyIds),
      ),
    );
  return new Set(
    rows
      .map((r) => r.registerId)
      .filter((id): id is string => id !== null),
  );
}
