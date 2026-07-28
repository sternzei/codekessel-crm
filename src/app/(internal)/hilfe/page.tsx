import { Suspense } from "react";
import { redirect } from "next/navigation";
import { HelpCenter } from "@/components/help/help-center";
import type { HelpRole } from "@/modules/help/types";
import { getSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const HelpFallback = () => (
  <div className="help-center">
    <p className="help-empty">Hilfe wird geladen…</p>
  </div>
);

export default async function HelpPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const viewerRole = session.role as HelpRole;
  return (
    <Suspense fallback={<HelpFallback />}>
      <HelpCenter viewerRole={viewerRole} viewerName={session.name} />
    </Suspense>
  );
}
