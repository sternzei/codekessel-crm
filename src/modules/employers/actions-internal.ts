"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { employers } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getSession } from "@/modules/auth/session";
import {
  isValidBic,
  isValidIban,
  normalizeBic,
  normalizeIban,
  parseSalaryComponents,
  parseStaffingBands,
} from "@/lib/ba-format";

// Internal (console) editing of the employer BA application data (Epic A).
// The same fields are also captured externally through the setup assistant;
// this is the consultant-facing edit path.

const schema = z.object({
  employerId: z.string().uuid(),
  legalForm: z.string().trim().max(100).optional(),
  iban: z.string().trim().max(40).optional(),
  bic: z.string().trim().max(20).optional(),
  betriebsvereinbarung: z.enum(["yes", "no"]).optional(),
});

export async function updateEmployerBaData(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const read = (key: string): string | undefined =>
    formData.get(key)?.toString();
  const parsed = schema.safeParse({
    employerId: formData.get("employerId"),
    legalForm: read("legalForm"),
    iban: read("iban"),
    bic: read("bic"),
    betriebsvereinbarung: read("betriebsvereinbarung") || undefined,
  });
  if (!parsed.success) redirect("/employers");
  const { employerId, legalForm, iban, bic, betriebsvereinbarung } = parsed.data;

  if (iban && !isValidIban(iban)) redirect("/employers?badata=iban");
  if (bic && !isValidBic(bic)) redirect("/employers?badata=bic");

  await withTenant(session.tenantId, async (tx) => {
    await tx
      .update(employers)
      .set({
        legalForm: legalForm || null,
        iban: iban ? normalizeIban(iban) : null,
        bic: bic ? normalizeBic(bic) : null,
        hasBetriebsvereinbarung:
          betriebsvereinbarung === "yes"
            ? true
            : betriebsvereinbarung === "no"
              ? false
              : null,
        staffingByHoursBand: parseStaffingBands(read),
        salaryComponents: parseSalaryComponents(read),
      })
      .where(eq(employers.id, employerId));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "employer",
      subjectId: employerId,
      event: "ba_data_updated",
    });
  });

  revalidatePath("/employers");
  redirect("/employers?badata=saved");
}
