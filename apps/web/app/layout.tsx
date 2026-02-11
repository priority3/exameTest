import "./globals.css";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, Noto_Sans_SC } from "next/font/google";

const sans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans"
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono"
});

export const metadata = {
  title: "exameTest",
  description: "AI-style testing platform (MVP)"
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html lang="zh">
      <body className={`${sans.variable} ${mono.variable}`}>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
