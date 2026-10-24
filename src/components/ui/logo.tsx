// The Penny Plan coin. With `animate`, the coin spins in and the check draws
// itself; without it, it is a still mark.
export function Logo({
  size = 64,
  animate = false,
  delay = 0,
  className = "",
}: {
  size?: number;
  animate?: boolean;
  delay?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Penny Plan"
      className={className}
      style={
        animate
          ? {
              animation: `coin-spin 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) ${delay}ms both`,
              transformOrigin: "50% 50%",
            }
          : undefined
      }
    >
      <defs>
        <linearGradient id="pp-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f0b72a" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="224" fill="url(#pp-coin)" />
      <circle
        cx="256"
        cy="256"
        r="182"
        fill="none"
        stroke="#c99a1b"
        strokeOpacity="0.7"
        strokeWidth="12"
      />
      <path
        d="M170 262 L232 324 L350 190"
        fill="none"
        stroke="#0b1f1a"
        strokeWidth="46"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={animate ? 1 : 0}
        style={
          animate
            ? { animation: `draw 0.55s ease-out ${delay + 620}ms forwards` }
            : undefined
        }
      />
    </svg>
  );
}
