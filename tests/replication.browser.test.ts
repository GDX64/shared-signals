import { describe, expect, test } from "vitest";
import { SigChannel, SignalsRoot } from "../src/lib";
import TestWorker from "./replication.worker.ts?worker";

describe("browser replication", () => {
  test("replicates async updates through a real worker", async () => {
    // const root = SignalsRoot.create();
    // const signal = root.signal(0);
    // signal.set(2);

    const worker = new TestWorker();

    const controlPort = SigChannel.fromWorker<any>(worker, "control");
    const replicationPort = SigChannel.fromWorker<any>(worker, "replication");
    const root = SignalsRoot.create();
    replicationPort.onMessage((op) => {
      root.applyOperation(op);
    });
    root.onChange((op) => {
      replicationPort.postMessage(op);
    });
    controlPort.postMessage("init");
    // await for is ready message
    await controlPort.read();
    const signal = root.signal(0);
    controlPort.postMessage(signal.id);
    const signalValue = await controlPort.read();
    expect(signalValue).toBe(0);
    signal.set(3);
    controlPort.postMessage("update");
    const signalValue2 = await controlPort.read();
    expect(signalValue2).toBe(3);
    const signalValue3 = await controlPort.read();
    expect(signalValue3).toBe(10);
  });
});
