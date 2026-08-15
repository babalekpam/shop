// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';

import { Button } from '../src/components/ui/Button';
import { Sheet } from '../src/components/ui/Sheet';
import { Price } from '../src/components/ui/Price';
import { PaymentStatus } from '../src/components/ui/PaymentStatus';
import { useDrag, type Bounds, type DragState } from '../src/lib/motion/useDrag';

beforeAll(() => {
  // jsdom does not implement pointer capture. The components rely on it, so stub it
  // rather than branch around it in production code.
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};
  Element.prototype.hasPointerCapture = function () {
    return false;
  };
});

afterEach(cleanup);

/**
 * Dispatch a pointer event with a controlled timestamp.
 *
 * Testing Library's fireEvent cannot set `timeStamp`, and velocity is measured from it —
 * without control of the clock every gesture reports the same velocity.
 *
 * Timestamps here start at 1000, never 0: React's synthetic event resolves timeStamp as
 * `nativeEvent.timeStamp || Date.now()`, so a zero is silently swapped for wall-clock
 * time and the velocity window spans thirty years. Real events start at navigation, so
 * this is a harness artefact rather than something production can hit.
 */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  target: Element,
  props: { clientX?: number; clientY?: number; timeStamp?: number; button?: number } = {},
) {
  const { timeStamp, ...rest } = props;
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 0, clientY: 0, pointerId: 1, button: 0, ...rest });
  // timeStamp is a getter on Event, so it has to be redefined rather than assigned.
  if (timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: timeStamp, configurable: true });
  }
  act(() => {
    target.dispatchEvent(event);
  });
}

function stubRect(element: Element, rect: Partial<DOMRect>) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

describe('Button', () => {
  it('shows feedback on pointer-down, not on click', () => {
    render(<Button>Pay</Button>);
    const button = screen.getByRole('button');
    expect(button.hasAttribute('data-pressed')).toBe(false);

    pointer('pointerdown', button);
    expect(button.hasAttribute('data-pressed')).toBe(true);

    pointer('pointerup', button);
    expect(button.hasAttribute('data-pressed')).toBe(false);
  });

  it('ignores secondary buttons', () => {
    render(<Button>Pay</Button>);
    const button = screen.getByRole('button');
    pointer('pointerdown', button, { button: 2 });
    expect(button.hasAttribute('data-pressed')).toBe(false);
  });

  it('cancels when dragged away and restores when dragged back', () => {
    render(<Button>Pay</Button>);
    const button = screen.getByRole('button');
    stubRect(button, { left: 0, right: 200, top: 0, bottom: 44, width: 200, height: 44 });

    pointer('pointerdown', button, { clientX: 10, clientY: 20 });
    expect(button.hasAttribute('data-pressed')).toBe(true);

    // Still inside the control, just at the far edge — a wide button should stay pressed.
    pointer('pointermove', button, { clientX: 190, clientY: 20 });
    expect(button.hasAttribute('data-pressed')).toBe(true);

    // Well outside the bounds plus slop.
    pointer('pointermove', button, { clientX: 400, clientY: 20 });
    expect(button.hasAttribute('data-pressed')).toBe(false);

    // Dragging back re-arms it.
    pointer('pointermove', button, { clientX: 100, clientY: 20 });
    expect(button.hasAttribute('data-pressed')).toBe(true);
  });
});

describe('useDrag', () => {
  function Harness(props: {
    onDrag?: (state: DragState) => void;
    onDragEnd?: (state: DragState) => void;
    bounds?: Bounds | (() => Bounds);
    dimension?: number | (() => number);
    axis?: 'inline' | 'block';
    lockAxis?: boolean;
    onDragStart?: () => void;
  }) {
    const { handlers, isDragging } = useDrag({
      axis: props.axis ?? 'block',
      ...(props.bounds !== undefined ? { bounds: props.bounds } : {}),
      ...(props.dimension !== undefined ? { dimension: props.dimension } : {}),
      ...(props.lockAxis !== undefined ? { lockAxis: props.lockAxis } : {}),
      ...(props.onDrag ? { onDrag: props.onDrag } : {}),
      ...(props.onDragEnd ? { onDragEnd: props.onDragEnd } : {}),
      ...(props.onDragStart ? { onDragStart: props.onDragStart } : {}),
    });
    return <div data-testid="drag" data-dragging={isDragging || undefined} {...handlers} />;
  }

  it('does not move before the hysteresis threshold', () => {
    const onDrag = vi.fn();
    render(<Harness onDrag={onDrag} />);
    const el = screen.getByTestId('drag');

    pointer('pointerdown', el, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', el, { clientY: 6, timeStamp: 1016 });
    expect(onDrag).not.toHaveBeenCalled();
    expect(el.hasAttribute('data-dragging')).toBe(false);
  });

  it('subtracts the threshold on commit so the element does not jump', () => {
    const onDrag = vi.fn();
    render(<Harness onDrag={onDrag} />);
    const el = screen.getByTestId('drag');

    pointer('pointerdown', el, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', el, { clientY: 30, timeStamp: 1016 });

    expect(onDrag).toHaveBeenCalledOnce();
    // 30px of travel, 10px of it spent reaching the threshold.
    expect(onDrag.mock.calls[0]![0].offset).toBe(20);
    expect(el.hasAttribute('data-dragging')).toBe(true);
  });

  it('abandons the gesture when the dominant movement is on the other axis', () => {
    const onDrag = vi.fn();
    render(<Harness onDrag={onDrag} axis="block" />);
    const el = screen.getByTestId('drag');

    pointer('pointerdown', el, { clientX: 0, clientY: 0, timeStamp: 1000 });
    // Mostly horizontal: a vertical sheet must let this through to the scroller.
    pointer('pointermove', el, { clientX: 40, clientY: 5, timeStamp: 1016 });
    pointer('pointermove', el, { clientX: 60, clientY: 30, timeStamp: 1032 });

    expect(onDrag).not.toHaveBeenCalled();
  });

  it('reports release velocity in px/s', () => {
    const onDragEnd = vi.fn();
    render(<Harness onDragEnd={onDragEnd} />);
    const el = screen.getByTestId('drag');

    pointer('pointerdown', el, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', el, { clientY: 30, timeStamp: 1000 });
    pointer('pointermove', el, { clientY: 80, timeStamp: 1050 });
    pointer('pointermove', el, { clientY: 110, timeStamp: 1100 });
    pointer('pointerup', el, { clientY: 110, timeStamp: 1100 });

    expect(onDragEnd).toHaveBeenCalledOnce();
    // 100px of tracked offset over 100ms.
    expect(onDragEnd.mock.calls[0]![0].velocity).toBeCloseTo(1000, 0);
  });

  it('does not fire onDragEnd for a press that never became a drag', () => {
    const onDragEnd = vi.fn();
    render(<Harness onDragEnd={onDragEnd} />);
    const el = screen.getByTestId('drag');

    pointer('pointerdown', el, { clientY: 0, timeStamp: 1000 });
    pointer('pointerup', el, { clientY: 2, timeStamp: 1020 });

    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it('resolves bounds after onDragStart has measured', () => {
    // Regression: a plain bounds object is captured during the first render, when a sheet
    // has not been laid out and its extent is still 0. That pinned the bounds to
    // {min: 0, max: 0}, so the entire first gesture was rubber-banded down to ~1px of
    // travel and the sheet appeared stuck.
    const onDrag = vi.fn();

    function Measured() {
      const extent = useRef(0);
      const { handlers } = useDrag({
        axis: 'block',
        bounds: () => ({ min: 0, max: extent.current }),
        dimension: () => extent.current,
        onDragStart: () => {
          extent.current = 400;
        },
        onDrag,
      });
      return <div data-testid="drag" {...handlers} />;
    }

    render(<Measured />);
    const el = screen.getByTestId('drag');
    pointer('pointerdown', el, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', el, { clientY: 200, timeStamp: 1016 });

    // Inside the measured bounds, so tracking is 1:1 — not resisted.
    expect(onDrag.mock.calls[0]![0].offset).toBe(190);
  });

  it('rubber-bands past the bound instead of stopping dead', () => {
    const onDrag = vi.fn();
    render(<Harness onDrag={onDrag} bounds={{ min: 0, max: 100 }} dimension={400} />);
    const el = screen.getByTestId('drag');

    pointer('pointerdown', el, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', el, { clientY: 210, timeStamp: 1016 });

    const offset = onDrag.mock.calls[0]![0].offset;
    expect(offset).toBeGreaterThan(100); // it moved past the bound
    expect(offset).toBeLessThan(200); // but resisted rather than tracking 1:1
  });

  it('flips the drag axis under RTL', () => {
    const onDrag = vi.fn();
    document.documentElement.setAttribute('dir', 'rtl');
    try {
      render(<Harness onDrag={onDrag} axis="inline" />);
      const el = screen.getByTestId('drag');
      pointer('pointerdown', el, { clientX: 0, timeStamp: 1000 });
      // Dragging physically left in Arabic is dragging toward the inline end.
      pointer('pointermove', el, { clientX: -50, timeStamp: 1016 });
      expect(onDrag.mock.calls[0]![0].offset).toBe(40);
    } finally {
      document.documentElement.removeAttribute('dir');
    }
  });
});

describe('Sheet', () => {
  it('renders a scrim for a modal sheet and none for a parallel one', () => {
    const { container, rerender } = render(
      <Sheet open onOpenChange={() => {}} aria-label="Checkout">
        body
      </Sheet>,
    );
    expect(container.querySelector('.sheet-scrim')).not.toBeNull();

    // The cart drawer is a parallel task: browsing continues behind it, undimmed.
    rerender(
      <Sheet open modal={false} onOpenChange={() => {}} aria-label="Cart">
        body
      </Sheet>,
    );
    expect(container.querySelector('.sheet-scrim')).toBeNull();
  });

  it('anchors to a logical edge', () => {
    render(
      <Sheet open edge="inline-end" onOpenChange={() => {}} aria-label="Cart">
        body
      </Sheet>,
    );
    expect(screen.getByRole('dialog').getAttribute('data-edge')).toBe('inline-end');
  });

  it('dismisses when the scrim is tapped', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <Sheet open onOpenChange={onOpenChange} aria-label="Checkout">
        body
      </Sheet>,
    );
    act(() => {
      container.querySelector('.sheet-scrim')!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('dismisses on a flick, and notifies exactly once', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <Sheet open onOpenChange={onOpenChange} aria-label="Checkout">
        body
      </Sheet>,
    );
    const panel = screen.getByRole('dialog');
    stubRect(panel, { height: 400, width: 320, bottom: 400, right: 320 });

    const handle = container.querySelector('.sheet-handle')!;
    pointer('pointerdown', handle, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', handle, { clientY: 40, timeStamp: 1016 });
    pointer('pointermove', handle, { clientY: 90, timeStamp: 1032 });
    pointer('pointerup', handle, { clientY: 90, timeStamp: 1032 });

    // Barely a quarter of the way down, but thrown hard: the projection carries it home.
    // The inverted guard this replaced swallowed the call entirely.
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('returns to open after a small, slow drag without notifying', () => {
    const onOpenChange = vi.fn();
    const { container } = render(
      <Sheet open onOpenChange={onOpenChange} aria-label="Checkout">
        body
      </Sheet>,
    );
    stubRect(screen.getByRole('dialog'), { height: 400, width: 320, bottom: 400, right: 320 });

    const handle = container.querySelector('.sheet-handle')!;
    pointer('pointerdown', handle, { clientY: 0, timeStamp: 1000 });
    pointer('pointermove', handle, { clientY: 30, timeStamp: 1200 });
    pointer('pointerup', handle, { clientY: 30, timeStamp: 1400 });

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('server rendering under our CSP', () => {
  // Our CSP runs style-src without unsafe-inline, so a style attribute in SSR markup is
  // dropped: a sheet would render on top of the page until hydration. This is the
  // mechanical check behind that acceptance criterion. (Design system §1.2, §8.)
  const cases: Array<[string, React.ReactElement]> = [
    ['Button', <Button key="b">Pay</Button>],
    [
      'Sheet (closed)',
      <Sheet key="s" open={false} onOpenChange={() => {}} aria-label="Cart">
        body
      </Sheet>,
    ],
    [
      'Sheet (open)',
      <Sheet key="so" open onOpenChange={() => {}} aria-label="Cart">
        body
      </Sheet>,
    ],
    ['Price', <Price key="p" amountMinor={2900} currency="USD" locale="en-US" />],
    [
      'PaymentStatus',
      <PaymentStatus
        key="ps"
        phase="awaiting_confirmation"
        startedAt={0}
        locale="fr-FR"
        strings={{
          submitting: 'Envoi',
          awaitingTitle: 'Vérifiez votre téléphone',
          awaitingDetail: 'Confirmez le paiement sur votre mobile.',
          verifying: 'Vérification',
          confirmed: 'Confirmé',
          failed: 'Échec',
          safeToLeave: 'Vous pouvez fermer cette page.',
          elapsedLabel: (d) => `En attente ${d}`,
          retry: 'Réessayer',
        }}
      />,
    ],
  ];

  it.each(cases)('%s renders no inline style attribute', (_name, element) => {
    expect(renderToString(element)).not.toMatch(/\sstyle=/);
  });
});
