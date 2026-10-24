import { describe, expect, it } from "vitest";
import { displayAmount, pressKey, type KeypadKey } from "@/lib/keypad";

function type(keys: KeypadKey[], digits = 2) {
  return keys.reduce((raw, key) => pressKey(raw, key, digits), "");
}

describe("pressKey", () => {
  it("builds a whole number", () => {
    expect(type(["4", "5"])).toBe("45");
  });

  it("drops a leading zero", () => {
    expect(type(["0", "5"])).toBe("5");
    expect(type(["0", "0", "0"])).toBe("0");
  });

  it("starts a decimal with 0.", () => {
    expect(type(["."])).toBe("0.");
    expect(type([".", "5"])).toBe("0.5");
  });

  it("allows only one decimal point", () => {
    expect(type(["1", ".", "5", "."])).toBe("1.5");
  });

  it("stops at the currency's decimal places", () => {
    expect(type(["1", ".", "2", "3", "4"])).toBe("1.23");
    expect(type(["1", ".", "2"], 0)).toBe("12");
  });

  it("ignores the decimal point for currencies without decimals", () => {
    expect(type(["1", "."], 0)).toBe("1");
  });

  it("deletes the last key and tolerates empty input", () => {
    expect(type(["1", "2", "back"])).toBe("1");
    expect(type(["back"])).toBe("");
  });

  it("caps the length", () => {
    const raw = type(Array<KeypadKey>(30).fill("9"));
    expect(raw).toHaveLength(14);
  });
});

describe("displayAmount", () => {
  it("groups thousands and keeps what was typed after the point", () => {
    expect(displayAmount("")).toBe("0");
    expect(displayAmount("1234")).toBe("1,234");
    expect(displayAmount("1234.")).toBe("1,234.");
    expect(displayAmount("1234.50")).toBe("1,234.50");
  });
});
