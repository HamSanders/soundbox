/** "Your shelf" / "Explore": the two Listen views. */

import { NavLink } from "react-router-dom";

import { cn } from "@/lib/utils";

const TABS = [
  { to: "/listen", label: "Your shelf", end: true },
  { to: "/listen/explore", label: "Explore", end: false },
];

export function ListenTabs() {
  return (
    <nav aria-label="Listen views" className="bg-muted inline-flex rounded-lg p-0.5">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
