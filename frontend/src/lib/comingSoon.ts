export type SoonPage = { title: string; phase: 9 | 10; about: string; links?: { to: string; label: string }[] }

/**
 * Menu items whose screen is not built yet: each opens a "coming soon" page (with the phase and what to use meanwhile).
 * Empty since Phase 10 — every menu item has its screen. Kept so a future menu entry can be parked here first.
 */
export const SOON: Record<string, SoonPage> = {}
