// Token bags: how a hunk is recognized in a resolved file even when the
// resolution reshaped the line (e.g. main's `timeout = 30` survives as
// `timeout = 30  # per tenant`). The signal is the hunk's *delta tokens*: what it
// added that was not there before, and what it removed.

export type Bag = Map<string, number>;

const TOKEN = /[A-Za-z0-9_]+|[^\sA-Za-z0-9_]+/g;

export function tokenize(line: string): string[] {
  return line.match(TOKEN) ?? [];
}

export function bagOf(lines: Iterable<string>): Bag {
  const bag: Bag = new Map();
  for (const l of lines) for (const t of tokenize(l)) bag.set(t, (bag.get(t) ?? 0) + 1);
  return bag;
}

/** a - b, keeping only positive counts. */
export function subtract(a: Bag, b: Bag): Bag {
  const out: Bag = new Map();
  for (const [t, n] of a) {
    const d = n - (b.get(t) ?? 0);
    if (d > 0) out.set(t, d);
  }
  return out;
}

export function total(bag: Bag): number {
  let n = 0;
  for (const v of bag.values()) n += v;
  return n;
}

/** A line worth reasoning about: contains a letter or digit. */
export function significant(line: string): boolean {
  return /[A-Za-z0-9]/.test(line);
}
