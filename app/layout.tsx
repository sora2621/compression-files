import { headers } from "next/headers";

import { AppHeader } from "@/components/app/app-header";
import { Toast } from "@/components/app/toast";
import { WorkspaceProvider } from "@/components/app/workspace-provider";

import type { Metadata } from "next";
import "./globals.css";

const title = "Compression Files｜画質を守るファイル最適化";
const description =
  "画像・動画・音声を実データから解析し、形式変換、画質補正、AI高画質化、メタデータ削除、容量最適化を行います。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? `${protocol}://${host ?? "localhost:3000"}`;

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    applicationName: "Compression Files",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "ja_JP",
      siteName: "Compression Files",
      images: [
        {
          url: "/og.png",
          width: 1728,
          height: 909,
          alt: "Compression Files — 画質は、そのまま。余計な重さだけ手放す。",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <WorkspaceProvider>
          <AppHeader />
          {children}
          <Toast />
        </WorkspaceProvider>
      </body>
    </html>
  );
}
