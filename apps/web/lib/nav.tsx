"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/transactions", label: "Transactions" },
  { href: "/upload", label: "Upload" },
];

/** Shared nav for every authenticated page (dashboard/transactions/upload)
 * — Stage 9 is the first stage with more than one real destination behind
 * login, so this is where AppShell's `nav` slot (reserved since Stage 3)
 * first gets real content. */
export function AppNav() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
          style={{
            fontSize: "0.875rem",
            fontWeight: pathname === link.href ? 600 : 400,
            color: pathname === link.href ? "var(--color-text)" : "var(--color-text-secondary)",
            textDecoration: "none",
          }}
        >
          {link.label}
        </Link>
      ))}
    </>
  );
}
