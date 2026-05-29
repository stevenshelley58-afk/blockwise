type BlockwiseLogoProps = {
  className?: string;
  showWordmark?: boolean;
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

export function BlockwiseLogo({ className = "", showWordmark = true }: BlockwiseLogoProps) {
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
              rx={3}
              fill="currentColor"
            />
          ))}
        </svg>
      </span>
      {showWordmark ? <span className="blockwise-wordmark">blockwise</span> : null}
    </span>
  );
}
