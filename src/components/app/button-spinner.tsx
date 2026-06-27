type ButtonSpinnerProps = {
  /** Pixel size; defaults to 16 to match the form button text height. */
  size?: number;
  /** Accessible label override; defaults to "Loading" (announced as aria-hidden so override rarely needed). */
  label?: string;
  className?: string;
};

/**
 * Inline 16px circular SVG spinner that inherits the surrounding `color`
 * (i.e. shows white inside a navy primary button, ink on a secondary).
 * CSS-only animation; no JS, no layout shift when reserved with `gap`.
 */
export function ButtonSpinner({ size = 16, label = "Loading", className }: ButtonSpinnerProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="status"
      aria-label={label}
      style={{ display: "inline-block", flex: "none" }}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
