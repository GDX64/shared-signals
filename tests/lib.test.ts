import { describe, expect, test } from "vitest";
import { SignalsRoot } from "../src/lib";

describe("lib", () => {
  test("api", () => {
    const root = SignalsRoot.create();

    const signal = root.signal(0);
    expect(signal.get()).toBe(0);
    signal.set(1);
    expect(signal.get()).toBe(1);

    const comp = SignalsRoot.computed(() => {
      return signal.get() * 2;
    });

    expect(comp.get()).toBe(2);
  });
});
