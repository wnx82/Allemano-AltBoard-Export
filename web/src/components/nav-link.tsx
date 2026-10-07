"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" || pathname.startsWith("/characters") : pathname.startsWith(href);
  const link = useRef<HTMLAnchorElement>(null);

  // Sur un écran étroit la navigation défile de côté : la page en cours y reste visible.
  useEffect(() => {
    if (active) link.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <Link
      ref={link}
      href={href}
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? "bg-gold/15 text-gold" : "text-muted hover:bg-white/5 hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}
