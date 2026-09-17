import type { ReactNode } from "react";

export const metadata = {
  title: "M-Pesa Intelligence — Admin",
  description: "Internal administration.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
