import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth/session";

export default async function Home() {
  const session = await getSession();
  redirect(session ? "/pipeline" : "/auth/sign-in");
}
