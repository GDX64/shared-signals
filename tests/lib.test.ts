import { describe, expect, test } from "vitest";
import { SignalsRoot, WritableSignal } from "../src/lib";

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
    const changes = root.recordChanges();
    const signal = root.signal(0);
    signal.set(1);
    signal.set(2);

    const state = root.copyState();
    const replica = SignalsRoot.fromState(state);
    const signalReplica = replica.fromID<number>(signal.id);
    signalReplica.set(3);
    expect(signalReplica.get()).toBe(3);

    const changeRoot = SignalsRoot.create();
    changeRoot.applyChanges(changes);
    const signalFromChanges = changeRoot.fromID<number>(signal.id);
    expect(signalFromChanges.get()).toBe(2);
    signalFromChanges.set(4);
    expect(signalFromChanges.get()).toBe(4);

    // Original signal should not reflect the change made to the replica
    expect(signal.get()).toBe(2);
  });

  test("nested signals", () => {
    const root = SignalsRoot.create();
    const num = root.signal(0);
    const sig = root.signal({
      num,
    });
    sig.get().num.set(1);
    expect(num.get()).toBe(1);

    const replica = SignalsRoot.fromState(root.copyState());
    const sigReplica = replica.fromID<{ num: WritableSignal<number> }>(sig.id);
    sigReplica.get().num.set(2);
    expect(sigReplica.get().num.get()).toBe(2);
    expect(num.get()).toBe(1);
  });
});
