import { describe, expect, it } from "vitest";
import { transcriptOf } from "@/lib/assistant/dictation";

const heard = (...transcripts: string[]) => transcripts.map((transcript) => ({ 0: { transcript } }));

describe("transcriptOf", () => {
  it("reads separate phrases in order", () => {
    expect(transcriptOf(heard("how much did I spend", " on food today"))).toBe(
      "how much did I spend on food today",
    );
  });

  it("does not repeat words when each result is the whole sentence so far (Android)", () => {
    expect(
      transcriptOf(heard("hello", "hello how", "hello how has", "hello how has this month", "hello how has this month been")),
    ).toBe("hello how has this month been");
  });

  it("still joins a new phrase after a cumulative one", () => {
    expect(transcriptOf(heard("add lunch", "add lunch forty", "and a taxi ride"))).toBe(
      "add lunch forty and a taxi ride",
    );
  });

  it("ignores empty results and differences in capital letters", () => {
    expect(transcriptOf(heard("", "Hello", "hello there"))).toBe("hello there");
    expect(transcriptOf([])).toBe("");
  });
});
