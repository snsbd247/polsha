import type { ReactNode } from 'react'

/** Line icons for the dashboard cards (24×24 stroke paths, drawn in the card's colour). */
const PATHS: Record<string, ReactNode> = {
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  userCheck: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16 11 2 2 4-4" />
    </>
  ),
  userX: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m17 8 5 5M22 8l-5 5" />
    </>
  ),
  userPlus: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V4h8v2M5 6l1 15h12l1-15" />
      <path d="M10 10v7M14 10v7" />
    </>
  ),
  restore: (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-4.5L4 8" />
      <path d="M4 3v5h5" />
      <path d="M4 13a8 8 0 0 0 14.5 4.5L20 16" />
      <path d="M20 21v-5h-5" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  userClock: (
    <>
      <path d="M12 15H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <circle cx="17.5" cy="17.5" r="4.5" />
      <path d="M17.5 15.5v2l1.3 1" />
    </>
  ),
  sprout: (
    <>
      <path d="M7 20h10M12 20v-9" />
      <path d="M12 11c0-3 2-5.5 6-5.5 0 3.5-2.5 5.5-6 5.5Z" />
      <path d="M12 13c0-2.5-1.8-4.5-5-4.5 0 3 2 4.5 5 4.5Z" />
    </>
  ),
  drop: <path d="M12 2.7s-6.5 7.2-6.5 11.8a6.5 6.5 0 0 0 13 0C18.5 9.9 12 2.7 12 2.7Z" fill="currentColor" />,
  bars: <path d="M5 20v-6M10 20V10M15 20V6M20 20V3" />,
  layers: (
    <>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8M16 13H8M16 17H8" />
    </>
  ),
  moneyBag: (
    <>
      <path d="M9 3h6l-1.5 3h-3Z" />
      <path d="M10.5 6C6 8.5 4 12.5 4 16a5 5 0 0 0 5 5h6a5 5 0 0 0 5-5c0-3.5-2-7.5-6.5-10" />
      <path d="M14 11.5h-2.5a1.5 1.5 0 0 0 0 3h1a1.5 1.5 0 0 1 0 3H10M12 10v1.5M12 17.5V19" />
    </>
  ),
  receipt: (
    <>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 10v2l1.5 1" />
    </>
  ),
  piggy: (
    <>
      <path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z" />
      <path d="M2 9v1c0 1.1.9 2 2 2h1" />
      <path d="M16 11h.01" />
    </>
  ),
  handCoins: (
    <>
      <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
      <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.91l-4.2 3.9" />
      <path d="m2 16 6 6" />
      <circle cx="16" cy="9" r="2.9" />
      <circle cx="6" cy="5" r="3" />
    </>
  ),
  share: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <circle cx="12" cy="11" r="3" />
      <path d="M16.5 18a4.5 4.5 0 0 0-9 0M8 2v3M16 2v3" />
    </>
  ),
  cash: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  bank: (
    <>
      <path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7" />
      <path d="M12 2 20 7H4Z" />
    </>
  ),
  building: (
    <>
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
      <path d="M10 6h4M10 10h4M10 14h4M10 18h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
    </>
  ),
  chart: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M20 8v6M17 11v3M23 11v3" />
    </>
  ),
}

export function DashIcon({ name, size = 28, color = 'currentColor', stroke = 2 }: { name: string; size?: number; color?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name] ?? PATHS.file}
    </svg>
  )
}
