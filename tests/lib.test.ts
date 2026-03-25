import { describe, expect, test } from "vitest";
import { SignalsRoot, WritableSignal } from "../src/lib";
import { time } from "console";

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

  test("replication", async () => {
    const root = SignalsRoot.create();
    const changes = root.recordChanges();
    const signal = root.signal(0);
    signal.set(1);
    signal.set(2);

    const state = root.copyState();
    const replica = SignalsRoot.fromState(state);

    //Setup change replication between root and replica
    replica.onAsyncRequest((op) => {
      root.applyOperation(op);
    });
    root.onChange((op) => {
      replica.applyOperation(op);
    });

    const signalReplica = replica.fromID<number>(signal.id);
    //Replicas should not be writable syncronously
    expect(() => {
      signalReplica.set(3);
    }).toThrowError();
    expect(signalReplica.get()).toBe(2);

    await signalReplica.setAsync(3);
    expect(signalReplica.get()).toBe(3);

    const changeRoot = SignalsRoot.create();
    changeRoot.applyChanges(changes);
    const signalFromChanges = changeRoot.fromID<number>(signal.id);
    expect(signalFromChanges.get()).toBe(2);

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
    expect(sigReplica.get().num.get()).toBe(1);
    expect(num.get()).toBe(1);
  });
});
