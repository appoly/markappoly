import type { ReactNode, SVGProps } from "react";

/** Shared wrapper — thin strokes, rounded caps, sized to sit in a toolbar button. */
function Icon({
  children,
  filled,
  size = 17,
  ...props
}: SVGProps<SVGSVGElement> & { children: ReactNode; filled?: boolean; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const SidebarIcon = () => (
  <Icon>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <line x1="9" y1="4.5" x2="9" y2="19.5" />
  </Icon>
);

export const OpenIcon = () => (
  <Icon>
    <path d="M3 7.5a2 2 0 0 1 2-2h3.1a2 2 0 0 1 1.5.7l.9 1a2 2 0 0 0 1.5.7H19a2 2 0 0 1 2 2v6.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" />
  </Icon>
);

export const SaveIcon = () => (
  <Icon>
    <path d="M12 3v10" />
    <path d="m8 9 4 4 4-4" />
    <path d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </Icon>
);

export const ReloadIcon = () => (
  <Icon>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Icon>
);

export const PresentIcon = () => (
  <Icon filled>
    <path d="M8 5.4a1 1 0 0 1 1.5-.87l9 6.6a1 1 0 0 1 0 1.74l-9 6.6A1 1 0 0 1 8 18.6Z" />
  </Icon>
);

export const MinusIcon = () => (
  <Icon size={16}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon size={16}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Icon>
);

export const ExportIcon = () => (
  <Icon>
    <path d="M12 15V4" />
    <path d="m8 8 4-4 4 4" />
    <path d="M4 16.5v2A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-2" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon filled>
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </Icon>
);

export const StarIcon = ({ filled }: { filled?: boolean }) => (
  <Icon filled={filled}>
    <path d="M12 3.6l2.5 5.2 5.7.7-4.2 4 1.1 5.6-5.1-2.8-5.1 2.8 1.1-5.6-4.2-4 5.7-.7Z" />
  </Icon>
);

export const GraphIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="2.4" />
    <circle cx="5" cy="6" r="1.8" />
    <circle cx="19" cy="7" r="1.8" />
    <circle cx="17" cy="18.5" r="1.8" />
    <line x1="10.2" y1="10.7" x2="6.4" y2="7.2" />
    <line x1="14.1" y1="10.8" x2="17.7" y2="8.1" />
    <line x1="13.5" y1="13.9" x2="15.9" y2="17.2" />
  </Icon>
);

export const ChevronIcon = () => (
  <svg
    className="chevron"
    viewBox="0 0 12 12"
    width="9"
    height="9"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m3 4.5 3 3 3-3" />
  </svg>
);
