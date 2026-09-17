import type { ReactNode } from "react";

export const metadata = {
  title: "M-Pesa Financial Intelligence",
  description: "Understand where your money went.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
