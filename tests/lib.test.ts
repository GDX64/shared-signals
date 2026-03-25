import { describe, expect, test } from "vitest";
import { SignalsRoot, WritableSignal, MapSignal } from "../src/lib";
import { Signal } from "../src/core/reactive";

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

    const replica = setupReplica(root);

    const signalReplica = replica.fromID<Signal<number>>(signal.id);
    //Replicas should not be writable syncronously
    expect(() => {
      signalReplica.set(3);
    }).toThrowError();
    expect(signalReplica.get()).toBe(2);

    await signalReplica.setAsync(3);
    expect(signalReplica.get()).toBe(3);

    const changeRoot = SignalsRoot.create();
    changeRoot.applyChanges(changes);
    const signalFromChanges = changeRoot.fromID<Signal<number>>(signal.id);
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
    const sigReplica = replica.fromID<Signal<{ num: WritableSignal<number> }>>(
      sig.id,
    );
    expect(sigReplica.get().num.get()).toBe(1);
    expect(num.get()).toBe(1);
  });

  test("reactive map", () => {
    const root = SignalsRoot.create();
    const map = root.map<string, number>();
    map.set("a", 1);
    expect(map.get("a")).toBe(1);
    const replica = setupReplica(root);
    const mapReplica = replica.fromID<MapSignal<string, number>>(map.id);
    expect(mapReplica.get("a")).toBe(1);
    map.set("b", 2);
    expect(map.get("b")).toBe(2);
    expect(mapReplica.get("b")).toBe(2);
  });

  test("reactive map propagates by key", () => {
    const root = SignalsRoot.create();
    const map = root.map<string, number>();

    map.set("a", 1);

    let runsA = 0;
    let runsB = 0;

    const compA = SignalsRoot.computed(() => {
      runsA += 1;
      return map.get("a") ?? 0;
    });
    const compB = SignalsRoot.computed(() => {
      runsB += 1;
      return map.get("b") ?? 0;
    });

    expect(compA.get()).toBe(1);
    expect(compB.get()).toBe(0);
    expect(runsA).toBe(1);
    expect(runsB).toBe(1);

    map.set("a", 10);
    expect(compA.get()).toBe(10);
    expect(compB.get()).toBe(0);
    expect(runsA).toBe(2);
    expect(runsB).toBe(1);

    map.set("b", 20);
    expect(compA.get()).toBe(10);
    expect(compB.get()).toBe(20);
    expect(runsA).toBe(2);
    expect(runsB).toBe(2);
  });
});

function setupReplica(root: SignalsRoot) {
  const replica = SignalsRoot.fromState(root.copyState());
  replica.onAsyncRequest((op) => {
    root.applyOperation(op);
  });
  root.onChange((op) => {
    replica.applyOperation(op);
  });
  return replica;
}
