import { describe, expect, test } from "vitest";
import { SignalsRoot } from "../src/lib";

describe("lib", () => {
  test("api", () => {
    const root = SignalsRoot.create();

    const signal = root.signal(0);
    expect(signal.get()).toBe(0);
    signal.set(1);
    expect(signal.get()).toBe(1);

    const sig2 = root.signal(0);

    const comp = SignalsRoot.computed(() => {
      return signal.get() * 2 + sig2.get();
    });

    expect(comp.get()).toBe(2);

    sig2.set(1);
    expect(comp.get()).toBe(3);
  });

  test("replication", () => {
    const root = SignalsRoot.create();
    const signal = root.signal(0);
    signal.set(1);
    signal.set(2);

    const state = root.copyState();
    const replica = SignalsRoot.fromState(state);
    const signalReplica = replica.fromID(signal.id);
    signalReplica.set(3);
    // Original signal should reflect the change made to the replica
    expect(signal.get()).toBe(2);
    expect(signalReplica.get()).toBe(3);
  });
});
