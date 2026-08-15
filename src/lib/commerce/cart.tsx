'use client';

/**
 * Cart state, with the price lock the build spec requires.
 *
 * §4: *"The price shown at add-to-cart is locked into the order for the duration of the
 * session; if the FX snapshot rolls over mid-checkout, the locked price stands."*
 *
 * So a line item stores the amount it was added at, not a reference to a price that can
 * move underneath it. `isLocked` compares that stored amount against the live one, which
 * is what lets the interface *show* the customer a held price rather than silently
 * charging a number that no longer matches the catalog. A discrepancy the customer can
 * see and understand is trustworthy; the same discrepancy unexplained looks like a bug.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { bySlug, priceFor, type Sku } from '../../data/catalog';

export interface CartLine {
  slug: string;
  quantity: number;
  /** The currency and amount the customer was shown. This is the contract. */
  currency: string;
  lockedAmountMinor: number;
  addedAt: number;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  currency: string | null;
  subtotalMinor: number;
  add: (sku: Sku, currency: string) => void;
  remove: (slug: string) => void;
  restore: (line: CartLine) => void;
  clear: () => void;
  /** True when the live catalog price no longer matches what was locked in. */
  isLocked: (line: CartLine) => boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = 'argilette.cart.v1';

function load(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Validate rather than trust: a stale or hand-edited entry must not be able to put a
    // price into the UI that never came from the catalog.
    return parsed.filter(
      (line): line is CartLine =>
        !!line &&
        typeof line === 'object' &&
        typeof (line as CartLine).slug === 'string' &&
        typeof (line as CartLine).currency === 'string' &&
        Number.isFinite((line as CartLine).lockedAmountMinor) &&
        Number.isFinite((line as CartLine).quantity) &&
        !!bySlug((line as CartLine).slug),
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Read after mount, never during render: the server has no localStorage, and reading it
  // during render would produce a hydration mismatch on every page with a cart badge.
  useEffect(() => {
    setLines(load());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // A full or disabled storage quota must not take the cart down with it.
    }
  }, [lines, hydrated]);

  const add = useCallback((sku: Sku, currency: string) => {
    const price = priceFor(sku, currency) ?? sku.prices[0];
    if (!price) return;
    setLines((current) => {
      const existing = current.find((line) => line.slug === sku.slug);
      if (existing) {
        return current.map((line) =>
          line.slug === sku.slug ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [
        ...current,
        {
          slug: sku.slug,
          quantity: 1,
          currency: price.currency,
          lockedAmountMinor: price.amountMinor,
          addedAt: Date.now(),
        },
      ];
    });
  }, []);

  const remove = useCallback((slug: string) => {
    setLines((current) => current.filter((line) => line.slug !== slug));
  }, []);

  // Removal is undo-with-a-toast, not a confirmation dialog: forgiveness over friction,
  // and dialogs are reserved for genuinely destructive, irreversible actions.
  const restore = useCallback((line: CartLine) => {
    setLines((current) =>
      current.some((l) => l.slug === line.slug) ? current : [...current, line],
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const isLocked = useCallback((line: CartLine) => {
    const sku = bySlug(line.slug);
    if (!sku) return false;
    const live = priceFor(sku, line.currency);
    return !!live && live.amountMinor !== line.lockedAmountMinor;
  }, []);

  const value = useMemo<CartContextValue>(() => {
    // Mixed currencies cannot be summed. The catalog keeps a cart in one currency by
    // construction; if that ever changes, this must become a per-currency breakdown
    // rather than a wrong total.
    const currency = lines[0]?.currency ?? null;
    const subtotalMinor = lines
      .filter((line) => line.currency === currency)
      .reduce((sum, line) => sum + line.lockedAmountMinor * line.quantity, 0);

    return {
      lines,
      count: lines.reduce((sum, line) => sum + line.quantity, 0),
      currency,
      subtotalMinor,
      add,
      remove,
      restore,
      clear,
      isLocked,
      open,
      setOpen,
    };
  }, [lines, add, remove, restore, clear, isLocked, open]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside a CartProvider');
  return context;
}
