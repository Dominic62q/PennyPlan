import { Mascot } from "@/components/ui/mascot";

export const SCENE_GREEN =
  "radial-gradient(120% 80% at 50% 0%, #17694f 0%, #0c4a38 52%, #08382a 100%)";

// Coins and sparks that fly out from behind Penny: angle (deg), distance (rem),
// size (px), delay (ms), colour.
const BURST = [
  [-90, 9.5, 12, 0, "#f4c542"],
  [-60, 8, 8, 60, "#7ff0c4"],
  [-30, 10, 14, 30, "#f4c542"],
  [0, 8.5, 9, 100, "#ffe08a"],
  [30, 10, 12, 20, "#f4c542"],
  [60, 8.5, 8, 80, "#7ff0c4"],
  [90, 9, 13, 40, "#ffe08a"],
  [120, 10, 9, 120, "#f4c542"],
  [150, 8, 12, 50, "#7ff0c4"],
  [180, 9.5, 10, 10, "#f4c542"],
  [210, 8.5, 14, 90, "#ffe08a"],
  [240, 10, 8, 70, "#f4c542"],
] as const;

// Penny celebrating on the brand green. Shown right after sign-in, first by the
// login page and then, in its resting state (`still`), by the splash on the
// other side of the redirect, so the hand-over looks like one continuous moment.
export function WelcomeScene({
  title,
  subtitle,
  still = false,
}: {
  title: string;
  subtitle: string;
  still?: boolean;
}) {
  return (
    <div
      aria-hidden
      className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden px-8 text-center text-white"
      style={{ background: SCENE_GREEN }}
    >
      <span
        className="absolute size-[26rem] rounded-full bg-gold/20 blur-3xl"
        style={{ animation: "glow-pulse 2.4s ease-in-out infinite" }}
      />

      <div className="relative size-[min(11rem,24dvh)]">
        {!still &&
          BURST.map(([angle, distance, size, delay, color]) => {
            const rad = (angle * Math.PI) / 180;
            return (
              <span
                key={angle}
                className="absolute left-1/2 top-1/2 rounded-full"
                style={
                  {
                    width: size,
                    height: size,
                    marginLeft: -size / 2,
                    marginTop: -size / 2,
                    background: color,
                    "--dx": `${Math.cos(rad) * distance}rem`,
                    "--dy": `${Math.sin(rad) * distance}rem`,
                    animation: `coin-burst 1.1s cubic-bezier(0.15, 0.7, 0.3, 1) ${380 + delay}ms both`,
                  } as React.CSSProperties
                }
              />
            );
          })}
        <span
          className="relative block size-full"
          style={still ? undefined : { animation: "pop-in 0.6s cubic-bezier(0.2, 0.9, 0.2, 1) 0.25s both" }}
        >
          <Mascot size="100%" mood="happy" />
        </span>
      </div>

      <p
        className="relative mt-9 text-3xl font-bold tracking-tight"
        style={still ? undefined : { animation: "fade-up 0.6s ease 0.6s both" }}
      >
        {title}
      </p>
      <p
        className="relative mt-2 max-w-64 text-base text-white/70"
        style={still ? undefined : { animation: "fade-up 0.6s ease 0.75s both" }}
      >
        {subtitle}
      </p>
    </div>
  );
}
