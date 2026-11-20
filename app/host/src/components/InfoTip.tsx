import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { measureFrame } from '../lib/overlay-place';
import { Icon } from './ui';

/**
 * A small "i" button that explains the control beside it. It is a toggletip: hover and keyboard focus show the text, a click or Enter pins it open,
 * Esc, a click elsewhere or leaving the button and the text close it (WCAG 1.4.13: dismissible, hoverable, persistent).
 * The text sits in a portal like VersionMemoryTooltip's, placed with lib/overlay-place.ts. The browser's interest invokers and anchor positioning are not
 * used: the desktop shell's web view may be older than the versions that have them, and a polyfill would be a new dependency.
 * `label` names what the button reveals ("More about the control vector"), the "i" alone is not a name.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
    const id = useId(), trigger = useRef<HTMLButtonElement>(null), bubble = useRef<HTMLDivElement>(null), timer = useRef<number>(0);
    const [hover, setHover] = useState(false), [focus, setFocus] = useState(false), [pinned, setPinned] = useState(false);
    const [position, setPosition] = useState({ left: 12, top: 12 });
    const open = hover || focus || pinned;
    const close = useCallback(() => { setHover(false); setFocus(false); setPinned(false); }, []);
    const enter = () => { window.clearTimeout(timer.current); setHover(true); };
    const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHover(false), 140); };
    useEffect(() => () => window.clearTimeout(timer.current), []);
    useLayoutEffect(() => {
        if (!open || !trigger.current)
            return;
        const { scale, viewport } = measureFrame();
        const rect = trigger.current.getBoundingClientRect(), width = Math.min(340 * scale, viewport.width - 24);
        const height = bubble.current?.getBoundingClientRect().height ?? 120 * scale;
        const left = Math.max(12, Math.min(rect.left, viewport.width - width - 12));
        const top = rect.bottom + height + 20 <= viewport.height ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
        setPosition({ left: left / scale, top: top / scale });
    }, [open, children]);
    useEffect(() => {
        if (!open)
            return;
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            close();
        } };
        const outside = (event: PointerEvent) => { const node = event.target as Node; if (!trigger.current?.contains(node) && !bubble.current?.contains(node))
            close(); };
        document.addEventListener('keydown', escape, true);
        document.addEventListener('pointerdown', outside, true);
        window.addEventListener('resize', close);
        return () => { document.removeEventListener('keydown', escape, true); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', close); };
    }, [open, close]);
    return <>
    <button ref={trigger} type="button" className="info-tip" aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined} onPointerEnter={enter} onPointerLeave={leave} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onClick={() => setPinned(v => !v)}><Icon name="info" size={16}/></button>
    {open ? createPortal(<div ref={bubble} id={id} role="tooltip" className="info-tip__bubble" style={position} onPointerEnter={enter} onPointerLeave={leave}>{children}</div>, document.body) : null}
  </>;
}
