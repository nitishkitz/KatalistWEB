import type { SVGProps } from "react";

/** The two inbox silhouettes from the approved profile mockup. */
export function SortedActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 11 6 3h12l3 8v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />
      <path d="M3 12h5l2 3h4l2-3h5M10 7l2 2 3-3" />
    </svg>
  );
}

export function CaughtActivityIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M12 2v10m-4-4 4 4 4-4M7 8H6l-3 6v6a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6l-3-6h-1" />
      <path d="M3 14h5l2 3h4l2-3h5" />
    </svg>
  );
}
