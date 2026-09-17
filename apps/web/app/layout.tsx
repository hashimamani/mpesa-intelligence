import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import { AuthProvider } from "../lib/auth-context";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans-loaded" });

export const metadata = {
  title: "M-Pesa Financial Intelligence",
  description: "Understand where your money went.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
