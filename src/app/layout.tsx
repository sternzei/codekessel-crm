import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import "@/styles/global.css";

export const metadata: Metadata = {
  title: "QCG Antragsplattform",
  description:
    "Prozessassistent für AZAV-Maßnahmen nach dem Qualifizierungschancengesetz",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
