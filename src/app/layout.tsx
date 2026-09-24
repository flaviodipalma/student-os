import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TimeZoneSync } from "@/components/app-shell/time-zone-sync";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    template: "%s · Student OS",
    default: "Student OS",
  },
  description: "Know what to do today: deadlines, classes and commitments in one plan.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the theme script sets the `dark` class before React hydrates.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Light / Dark / System before the first paint: no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* Reports the browser's time zone, so "today" is the student's everywhere. */}
        <TimeZoneSync />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
