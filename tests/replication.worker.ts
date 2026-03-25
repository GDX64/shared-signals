import { SigChannel, SignalsRoot, SignalOperation } from "../src/lib";

const controlPort = SigChannel.fromWorkerContext<any>(self, "control");
const replicationPort = SigChannel.fromWorkerContext<SignalOperation>(
  self,
  "replication",
);

async function main(): Promise<void> {
  await controlPort.read();
  controlPort.postMessage("ready");

  const setup = await controlPort.read();
  const root = SignalsRoot.fromState(setup.state);

  replicationPort.onMessage((op) => {
    root.applyOperation(op);
  });
  root.onAsyncRequest((op) => {
    replicationPort.postMessage(op);
  });

  const signalID = setup.signalID;
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
