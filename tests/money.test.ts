import { describe, expect, it } from "vitest";
import {
  formatMoney,
  minorToInput,
  minorUnitDigits,
  parseMoney,
} from "@/lib/money";

describe("parseMoney", () => {
  it.each([
    ["45", 4500],
    ["45.5", 4550],
    ["45.50", 4550],
    ["0.05", 5],
    [" 1,240.50 ", 124050],
    ["1 240.50", 124050],
    ["0", 0],
  ])("parses %j as %j minor units", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each(["", "abc", "-5", "4.505", "1.2.3", "12,5x", "99999999999999999"])(
    "rejects %j",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );

  it("avoids float rounding errors", () => {
    expect(parseMoney("0.1")! + parseMoney("0.2")!).toBe(parseMoney("0.3"));
    expect(parseMoney("19.99")).toBe(1999);
  });

  it("respects currencies with no minor unit", () => {
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(parseMoney("500", "JPY")).toBe(500);
    expect(parseMoney("500.5", "JPY")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats cedis for en-GH", () => {
    const text = formatMoney(124050);
    expect(text).toContain("1,240.50");
    expect(text).toMatch(/GH₵|GHS/);
  });

  it("shows negatives and zero", () => {
    expect(formatMoney(-500)).toContain("5.00");
    expect(formatMoney(0)).toContain("0.00");
  });
});

describe("minorToInput", () => {
  it("round trips with parseMoney", () => {
    for (const minor of [0, 5, 4550, 124050]) {
      expect(parseMoney(minorToInput(minor))).toBe(minor);
    }
  });
});
