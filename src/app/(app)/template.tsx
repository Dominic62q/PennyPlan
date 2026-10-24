// A template remounts on every navigation, so each screen eases in.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter flex flex-1 flex-col gap-5">{children}</div>;
}
