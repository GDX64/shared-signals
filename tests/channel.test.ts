import { describe, expect, test } from "vitest";
import { SigChannel } from "../src/SigChannel";

describe("channel", () => {
  test("channel", async () => {
    const channel = new SigChannel<number>("test");
    const { p1, p2 } = channel;

    p1.postMessage(0);
    const m = await p2.read();
    expect(m).toBe(0);
    setTimeout(() => {
      p1.postMessage(1);
    });
    const m2 = await p2.read();
    expect(m2).toBe(1);
  });
});
