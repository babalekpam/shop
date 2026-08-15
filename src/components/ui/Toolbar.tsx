'use client';

/**
 * Toolbar — a translucent floating layer with content scrolling underneath.
 *
 * Not an opaque bar that consumes a fixed strip of the viewport. The material brings
 * structure without stealing focus, and the content stays continuous behind it.
 *
 * Where content passes under the toolbar we fade a short gradient rather than drawing a
 * 1px divider — and only while content is actually beneath it. A permanent hairline says
 * "there is a boundary here" even when there is nothing to separate.
 *
 * See docs/design-system.md §3 and .claude/skills/apple-design/SKILL.md §12.
 */

import { useEffect, useRef, useState } from 'react';

export interface ToolbarProps {
  children: React.ReactNode;
  /** `block-start` for a header, `block-end` for a bottom bar. Logical, never top/bottom. */
  edge?: 'block-start' | 'block-end' | undefined;
  className?: string | undefined;
}

export function Toolbar({ children, edge = 'block-start', className }: ToolbarProps) {
  const [overlapping, setOverlapping] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    // Cheaper and steadier than a scroll listener: no per-frame main-thread work, and no
    // debounce to audit off the input path.
    const observer = new IntersectionObserver(
      ([entry]) => setOverlapping(!entry?.isIntersecting),
      { threshold: 1 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className="toolbar-sentinel" aria-hidden="true" />
      <header
        className={['toolbar', 'material-regular', className].filter(Boolean).join(' ')}
        data-edge={edge}
        data-overlapping={overlapping || undefined}
      >
        {children}
      </header>
    </>
  );
}
