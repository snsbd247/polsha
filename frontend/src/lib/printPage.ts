import { useEffect } from 'react'

/**
 * The paper a page prints on (`@page`), only while that page is open.
 *
 * An `@page` rule written in a page's CSS file stays in the document after
 * leaving the page (the app never unloads CSS), so it would turn every later
 * print to that size. Pages that need a set paper size call this instead.
 * When two are open, the one mounted last wins.
 */
export function usePrintPage(size: string | null | undefined, margin = '10mm') {
  useEffect(() => {
    if (!size) return
    const el = document.createElement('style')
    el.setAttribute('data-print-page', size)
    el.textContent = `@media print { @page { size: ${size}; margin: ${margin}; } }`
    document.head.appendChild(el)
    return () => el.remove()
  }, [size, margin])
}
