import { SigChannel, SignalsRoot } from "../src/lib";

const controlPort = SigChannel.fromWorkerContext(self, "control");
const replicationPort = SigChannel.fromWorkerContext(self, "replication");

const root = SignalsRoot.create();
replicationPort.onMessage((op) => {
  root.applyOperation(op);
});
root.onChange((op) => {
  replicationPort.postMessage(op);
});

async function main(): Promise<void> {
  await controlPort.read();
  controlPort.postMessage("ready");
  const signalID = await controlPort.read();
  const signal = root.fromID<number>(signalID);
  controlPort.postMessage(signal.get());
  await controlPort.read();
  const newValue = signal.get();
  controlPort.postMessage(newValue);
  await signal.setAsync(10);
  const updatedValue = signal.get();
  controlPort.postMessage(updatedValue);
}

void main();
