import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20, sw = 2): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
});

export const Bell = ({ size, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>;
export const HomeIcon = ({ size = 22, ...p }: P) => <svg {...base(size)} {...p}><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" /></svg>;
export const CalendarIcon = ({ size = 22, ...p }: P) => <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>;
export const CheckIcon = ({ size = 22, ...p }: P) => <svg {...base(size)} {...p}><path d="M9 11l3 3 8-8" /><path d="M20 12v8H4V4h11" /></svg>;
export const UserIcon = ({ size = 22, ...p }: P) => <svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>;
export const Back = ({ size = 20, ...p }: P) => <svg {...base(size, 2.2)} {...p}><path d="M15 18l-6-6 6-6" /></svg>;
export const ChevronDown = ({ size = 16, ...p }: P) => <svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>;
export const Arrow = ({ size = 18, ...p }: P) => <svg {...base(size, 2.4)} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Plus = ({ size = 20, ...p }: P) => <svg {...base(size, 2.2)} {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const Share = ({ size = 18, ...p }: P) => <svg {...base(size)} {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></svg>;
export const Shield = ({ size = 22, ...p }: P) => <svg {...base(size)} {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg>;
export const Copy = ({ size = 18, ...p }: P) => <svg {...base(size)} {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>;

/** Bola de padel da marca. */
export const Ball = ({ size = 40, stroke = 2, style }: { size?: number; stroke?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ flex: "none", ...style }}>
    <circle cx="20" cy="20" r="18" fill="#F2A516" />
    <path d="M3 17c8 1 14-4 15-14M37 23c-8-1-14 4-15 14" fill="none" stroke="#FFE2A6" strokeWidth={stroke} />
  </svg>
);
