export type Mood = "idle" | "happy" | "thinking" | "reading" | "sorry";

const INK = "#0b1f1a";

// Where the eyes look and what the mouth does for each mood.
const LOOK: Record<Mood, { x: number; y: number }> = {
  idle: { x: 0, y: 0 },
  happy: { x: 0, y: 0 },
  thinking: { x: 16, y: -16 },
  reading: { x: 0, y: 18 },
  sorry: { x: 0, y: 6 },
};

const MOUTH: Record<Mood, string> = {
  idle: "M176 300 L230 350 L340 252",
  happy: "M160 292 L226 362 L352 236",
  thinking: "M222 332 L292 322",
  reading: "M210 326 L246 350 L304 304",
  sorry: "M196 352 Q256 304 316 352",
};

// Penny's face: the coin with a check-mark smile. Moods change the eyes and mouth;
// `animate` adds a gentle bob, blinking and a glint. Small sizes (the chat avatar)
// can stay still. Everything here is decoration, so it is hidden from screen readers
// unless a label is given.
export function Mascot({
  size = 64,
  mood = "idle",
  animate = true,
  label,
  className = "",
}: {
  size?: number | string;
  mood?: Mood;
  animate?: boolean;
  label?: string;
  className?: string;
}) {
  const look = LOOK[mood];
  const arcs = mood === "happy";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={`${animate ? "mascot-float" : ""} ${className}`}
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="pm-coin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#f0b72a" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="224" fill="url(#pm-coin)" />
      <circle cx="256" cy="256" r="196" fill="none" stroke="#c99a1b" strokeOpacity="0.55" strokeWidth="10" />
      <path
        d="M120 190 Q152 112 236 94"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.55"
        strokeWidth="14"
        strokeLinecap="round"
        className={animate ? "mascot-glint" : undefined}
      />

      <circle cx="132" cy="296" r="26" fill="#f6a39a" opacity="0.55" />
      <circle cx="380" cy="296" r="26" fill="#f6a39a" opacity="0.55" />

      <g style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: "transform 0.35s ease" }}>
        {arcs ? (
          <g fill="none" stroke={INK} strokeWidth="24" strokeLinecap="round">
            <path d="M154 218 Q184 170 214 218" />
            <path d="M298 218 Q328 170 358 218" />
          </g>
        ) : (
          <g fill={INK} className={animate ? "mascot-blink" : undefined}>
            <ellipse cx="184" cy="208" rx="24" ry="34" />
            <ellipse cx="328" cy="208" rx="24" ry="34" />
            <circle cx="192" cy="194" r="9" fill="#fff" />
            <circle cx="336" cy="194" r="9" fill="#fff" />
          </g>
        )}
      </g>

      {mood === "sorry" && (
        <path d="M148 150 L212 164 M364 150 L300 164" stroke={INK} strokeWidth="14" strokeLinecap="round" fill="none" />
      )}

      <path
        d={MOUTH[mood]}
        fill="none"
        stroke={INK}
        strokeWidth={mood === "thinking" ? 20 : 30}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {mood === "thinking" && (
        <g fill="#f4c542" className={animate ? "mascot-dots" : undefined}>
          <circle cx="408" cy="54" r="13" />
          <circle cx="448" cy="20" r="17" />
          <circle cx="496" cy="-20" r="22" />
        </g>
      )}
    </svg>
  );
}
