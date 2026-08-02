type BlockwiseLogoProps = {
  className?: string;
  showWordmark?: boolean;
  /**
   * Render with Tailwind utilities instead of the `blockwise-*` classes from
   * globals.css. The customer surface opts in so it carries no dependency on
   * the legacy stylesheet; operator, monitor, marketing and legal shells keep
   * the legacy classes (and their `.brand`-scoped size overrides) until their
   * own migration.
   */
  tokens?: boolean;
};

// Six filled cells form the staircase mark:
//   . . ■
//   . ■ ■
//   ■ ■ ■
const FILLED_CELLS: ReadonlyArray<[number, number]> = [
  [2, 0],
  [1, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

export function BlockwiseLogo({
  className = "",
  showWordmark = true,
  tokens = false,
}: BlockwiseLogoProps) {
  if (tokens) {
    return (
      <span
        className={["inline-flex items-center gap-[11px] leading-none text-inherit", className]
          .filter(Boolean)
          .join(" ")}
      >
        <span aria-hidden="true" className="inline-block size-7 shrink-0 text-(--color-accent)">
          <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="presentation" className="block size-full">
            {FILLED_CELLS.map(([x, y]) => (
              <rect key={`${x}-${y}`} x={x * 34} y={y * 34} width={28} height={28} rx={4.5} fill="currentColor" />
            ))}
          </svg>
        </span>
        {showWordmark ? (
          <span className="text-[20px] font-semibold tracking-[-0.025em] text-inherit">blockwise</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className={["blockwise-logo", className].filter(Boolean).join(" ")}>
      <span className="blockwise-symbol" aria-hidden="true">
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="presentation">
          {FILLED_CELLS.map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              x={x * 34}
              y={y * 34}
              width={28}
              height={28}
              rx={4.5}
              fill="currentColor"
            />
          ))}
        </svg>
      </span>
      {showWordmark ? <span className="blockwise-wordmark">blockwise</span> : null}
    </span>
  );
}
