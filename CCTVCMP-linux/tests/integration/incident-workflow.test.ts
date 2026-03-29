import { describe, expect, it } from "vitest";
import { mapStatusToAction, nextStatus } from "@/lib/workflows/incident";

describe("incident workflow", () => {
  it("allows valid status transitions", () => {
    expect(nextStatus("open", "acknowledged")).toBe(true);
    expect(nextStatus("acknowledged", "resolved")).toBe(true);
  });

  it("blocks invalid status transitions", () => {
    expect(nextStatus("open", "resolved")).toBe(false);
    expect(nextStatus("resolved", "open")).toBe(false);
  });

  it("maps status to log action", () => {
    expect(mapStatusToAction("acknowledged")).toBe("acknowledged");
    expect(mapStatusToAction("resolved")).toBe("resolved");
    expect(mapStatusToAction("open")).toBe("updated");
  });
});
