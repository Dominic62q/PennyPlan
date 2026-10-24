import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveDisplayName = vi.fn();

vi.mock("@/lib/profile", () => ({
  profileNameKey: ["profile", "name"],
  saveDisplayName: (name: string) => saveDisplayName(name),
}));

import { runTool } from "@/lib/assistant/tools";

let queryClient: QueryClient;
const run = (args: unknown) => runTool({ queryClient }, "set_my_name", JSON.stringify(args)).then((s) => JSON.parse(s));

beforeEach(() => {
  queryClient = new QueryClient();
  saveDisplayName.mockReset().mockImplementation(async (name: string) => name.trim());
});

describe("set_my_name", () => {
  it("saves the name and updates what the screens show", async () => {
    const result = await run({ name: "Ama" });
    expect(saveDisplayName).toHaveBeenCalledWith("Ama");
    expect(result).toMatchObject({ saved: true, name: "Ama" });
    expect(queryClient.getQueryData(["profile", "name"])).toBe("Ama");
  });

  it("refuses an empty or oversized name before saving anything", async () => {
    expect((await run({ name: "  " })).error).toMatch(/Bad input/);
    expect((await run({ name: "A".repeat(41) })).error).toMatch(/Bad input/);
    expect(saveDisplayName).not.toHaveBeenCalled();
  });

  it("reports a name that isn't valid or couldn't be saved, without claiming success", async () => {
    saveDisplayName.mockRejectedValue(new Error("Use letters only"));
    const result = await run({ name: "Ama2" });
    expect(result.error).toBe("Use letters only");
    expect(queryClient.getQueryData(["profile", "name"])).toBeUndefined();
  });
});
