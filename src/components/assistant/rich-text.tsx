import { Fragment, type ReactNode } from "react";

// Penny writes a little markdown: **bold**, `code`, "- " bullets, "1. " lists and
// "#" headings. This turns just those into tidy text, as React nodes (never HTML),
// and leaves everything else as typed.

type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,4}\s+(.*)$/;

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      flush();
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)![1];
      if (last?.kind === kind && paragraph.length === 0) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (line.trim() === "") {
      flush();
    } else {
      const heading = HEADING.exec(line);
      flush();
      if (heading) blocks.push({ kind: "p", text: `**${heading[1]}**` });
      else paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-surface-3 px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** The same text without markdown marks, for copying. */
export function plainText(text: string) {
  return text.replace(/\*\*([^*\n]+)\*\*/g, "$1").replace(/`([^`\n]+)`/g, "$1");
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {blocksOf(text).map((block, i) =>
        block.kind === "p" ? (
          <p key={i} className="whitespace-pre-wrap">
            {inline(block.text)}
          </p>
        ) : (
          <ul
            key={i}
            className={`flex flex-col gap-1.5 pl-5 ${block.kind === "ul" ? "list-disc" : "list-decimal"} marker:text-ink-3`}
          >
            {block.items.map((item, j) => (
              <li key={j} className="pl-0.5">
                {inline(item)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
