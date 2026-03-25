import { describe, expect, test } from "vitest";
import { SigChannel, SignalOperation, SignalsRoot } from "../src/lib";
import TestWorker from "./replication.worker.ts?worker";

describe("browser replication", () => {
  test("replicates async updates through a real worker", async () => {
    const worker = new TestWorker();

    const controlPort = SigChannel.fromWorker<any>(worker, "control");
    const replicationPort = SigChannel.fromWorker<SignalOperation>(
      worker,
      "replication",
    );
    const root = SignalsRoot.create();
    replicationPort.onMessage((op) => {
      root.applyOperation(op);
    });
    root.onChange((op) => {
      replicationPort.postMessage(op);
    });

    const signal = root.signal(0);

    controlPort.postMessage("init");
    await controlPort.read();

    controlPort.postMessage({
      state: root.copyState(),
      signalID: signal.id,
    });
    const signalValue = await controlPort.read();
    expect(signalValue).toBe(0);

    signal.set(3);
    controlPort.postMessage("update");
    const signalValue2 = await controlPort.read();
    expect(signalValue2).toBe(3);

    const signalValue3 = await controlPort.read();
    expect(signalValue3).toBe(10);

    // test nested signals

    const counter = root.signal(0);
    const nested = root.signal({
      counter,
    });
    counter.set(5);
    controlPort.postMessage(nested.id);

    const nestedEchoValue = await controlPort.read();
    expect(nestedEchoValue).toBe(5);
    const nestedEchoValue2 = await controlPort.read();
    expect(nestedEchoValue2).toBe(11);
  });
});
