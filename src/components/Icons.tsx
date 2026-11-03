type P = { className?: string; filled?: boolean };

const base = { width: 32, height: 32, viewBox: "0 0 24 24", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const HeartIcon = ({ className, filled }: P) => (
  <svg {...base} className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor">
    <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.8 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.3 3.3 4.2 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" />
  </svg>
);

export const BookmarkIcon = ({ className, filled }: P) => (
  <svg {...base} className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor">
    <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1z" />
  </svg>
);

export const ShareIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="none" stroke="currentColor">
    <path d="M14 4l7 7-7 7v-4c-6 0-9 2-11 6 .5-6 3.5-11 11-11V4z" />
  </svg>
);

export const PlayIcon = ({ className }: P) => (
  <svg {...base} className={className} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
);

export const VolumeIcon = ({ className, filled }: P) => (
  <svg {...base} width={24} height={24} className={className} fill="none" stroke="currentColor">
    <path d="M4 9.5v5h4l5 4v-13l-5 4H4z" />
    {filled ? <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M17 9.5l4 5M21 9.5l-4 5" />}
  </svg>
);

export const FullscreenIcon = ({ className }: P) => (
  <svg {...base} width={22} height={22} className={className} fill="none" stroke="currentColor">
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </svg>
);

export const RefreshIcon = ({ className }: P) => (
  <svg {...base} width={22} height={22} className={className} fill="none" stroke="currentColor">
    <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5" />
  </svg>
);

export const PlusIcon = ({ className }: P) => (
  <svg {...base} width={24} height={24} className={className} fill="none" stroke="currentColor">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CloseIcon = ({ className }: P) => (
  <svg {...base} width={22} height={22} className={className} fill="none" stroke="currentColor">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
