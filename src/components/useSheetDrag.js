import { useRef, useState } from 'react';

// Vertical drag for the phone bottom sheet. While dragging, `offset` follows the finger;
// on release `onRelease(dy, velocity)` decides where to snap. A short tap calls `onTap`.
export function useSheetDrag({ onRelease, onTap }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null);

  const bind = {
    onPointerDown(event) {
      if (!event.isPrimary || event.target.closest('button, a, input, label')) return;
      start.current = { y: event.clientY, t: performance.now() };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove(event) {
      if (start.current) setOffset(event.clientY - start.current.y);
    },
    onPointerUp(event) {
      const begun = start.current;
      start.current = null;
      setDragging(false);
      setOffset(0);
      if (!begun) return;
      const dy = event.clientY - begun.y;
      if (Math.abs(dy) < 6) onTap?.();
      else onRelease(dy, dy / Math.max(1, performance.now() - begun.t));
    },
    onPointerCancel() {
      start.current = null;
      setDragging(false);
      setOffset(0);
    },
  };

  return { offset, dragging, bind };
}
