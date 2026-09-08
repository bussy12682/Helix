import { Link } from "@tanstack/react-router";

export function HelixMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="helix-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.72 0.17 292)" />
          <stop offset="100%" stopColor="oklch(0.62 0.16 250)" />
        </linearGradient>
      </defs>
      <path
        d="M8 3c0 7 16 7 16 13S8 22 8 29"
        fill="none"
        stroke="url(#helix-grad)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M24 3c0 7-16 7-16 13s16 6 16 13"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HelixLogo({
  to = "/",
  tone = "default",
}: {
  to?: string;
  tone?: "default" | "night";
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight ${
        tone === "night" ? "text-night-foreground" : "text-foreground"
      }`}
    >
      <HelixMark />
      HELIX
    </Link>
  );
}
