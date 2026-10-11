import { useEffect } from 'react'

/** Elements where Space already means something (typing, pressing, choosing). */
const OWN_SPACE = 'input, textarea, select, button, a, [contenteditable="true"]'

/** Space pauses and resumes, unless the user is typing or focused on a control that uses Space itself. */
export function useSpacebarToggle(toggle: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.target instanceof Element && event.target.closest(OWN_SPACE)) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])
}
