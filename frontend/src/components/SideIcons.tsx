/** Solid sidebar glyphs that antd has no filled variant for (people, person). Sized like antd icons (1em). */
const wrap = (path: React.ReactNode, className?: string) => (
  <span role="img" className={`anticon ${className ?? ''}`}>
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
      {path}
    </svg>
  </span>
)

export const TeamSolid = ({ className }: { className?: string }) =>
  wrap(
    <>
      <circle cx="9" cy="7.5" r="4" />
      <path d="M1.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7v1h-15v-1z" />
      <circle cx="17.2" cy="8.3" r="3.1" />
      <path d="M17.6 13.1c2.9.3 4.9 2.6 4.9 5.9v2h-4.4v-1.2c0-2.7-.9-4.9-2.6-6.4.7-.2 1.4-.3 2.1-.3z" />
    </>,
    className,
  )

export const UserSolid = ({ className }: { className?: string }) =>
  wrap(
    <path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21zm0 4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zm0 15a8.4 8.4 0 0 1-6.3-2.8c.9-2.3 3.4-3.7 6.3-3.7s5.4 1.4 6.3 3.7A8.4 8.4 0 0 1 12 20.5z" />,
    className,
  )
