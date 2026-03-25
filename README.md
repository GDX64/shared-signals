# shared-signals

`@glmachado/shared-signals` is a small signals library focused on **state replication across contexts** (main thread, Web Workers, and replicas).

## Goals

- Provide a simple signal API (`get`, `set`, `setAsync`) with computed signals.
- Support full-state cloning (`copyState` / `fromState`) for replicas.
- Support operation-based synchronization (`onChange`, `applyOperation`).
- Support async write requests from replicas (`onAsyncRequest`) for worker-friendly architectures.
- Make worker messaging easier with a typed channel helper (`SigChannel`).

## Install

```bash
npm install @glmachado/shared-signals
```

## API Overview

```ts
import { SignalsRoot, SigChannel } from "@glmachado/shared-signals";
import type {
  WritableSignal,
  ReadableSignal,
  SignalsState,
  SignalOperation,
  SignalAsyncRequest,
} from "@glmachado/shared-signals";
```

## Basic Signals

```ts
import { SignalsRoot } from "@glmachado/shared-signals";

const root = SignalsRoot.create();

const count = root.signal(0);
count.set(1);
console.log(count.get()); // 1

const multiplier = root.signal(2);
const total = SignalsRoot.computed(() => count.get() * multiplier.get());
console.log(total.get()); // 2

multiplier.set(3);
console.log(total.get()); // 3
```

## State Replication

Create a replica from a snapshot and connect operation streams:

```ts
import { SignalsRoot } from "@glmachado/shared-signals";

const root = SignalsRoot.create();
const value = root.signal(10);

const state = root.copyState();
const replica = SignalsRoot.fromState(state);

// forward root local changes to replica
root.onChange((op) => {
  replica.applyOperation(op);
});

const replicaValue = replica.fromID<number>(value.id);
console.log(replicaValue.get()); // 10
```

## Async Writes From Replica (`setAsync`)

Replicas are read-only for synchronous writes, but can request writes asynchronously:

```ts
import { SignalsRoot } from "@glmachado/shared-signals";

const root = SignalsRoot.create();
const source = root.signal(0);

const replica = SignalsRoot.fromState(root.copyState());
const replicaSignal = replica.fromID<number>(source.id);

// replica emits async requests
replica.onAsyncRequest((request) => {
  // writable root handles request and emits ack operation
  root.applyOperation(request);
});

// root operations are forwarded back to replica
root.onChange((op) => {
  replica.applyOperation(op);
});

await replicaSignal.setAsync(42);
console.log(replicaSignal.get()); // 42
console.log(source.get()); // still 0 (original signal is independent unless you sync state back)
```

## Nested Signals

Signals can contain references to other signals:

```ts
import { SignalsRoot } from "@glmachado/shared-signals";
import type { WritableSignal } from "@glmachado/shared-signals";

const root = SignalsRoot.create();
const counter = root.signal(0);
const nested = root.signal({ counter });

nested.get().counter.set(5);

const replica = SignalsRoot.fromState(root.copyState());
const nestedReplica = replica.fromID<{ counter: WritableSignal<number> }>(nested.id);
console.log(nestedReplica.get().counter.get()); // 5
```

## Worker Helper: `SigChannel`

`SigChannel` provides two patterns:

1. In-memory duplex channel (`new SigChannel<T>()`) for local flows/tests.
2. Worker wrappers with named channels:
   - `SigChannel.fromWorker(worker, "channel-name")`
   - `SigChannel.fromWorkerContext(self, "channel-name")`

### In-memory example

```ts
import { SigChannel } from "@glmachado/shared-signals";

const channel = new SigChannel<number>();
const { p1, p2 } = channel;

p1.postMessage(7);
console.log(await p2.read()); // 7
```

### Worker example

Main thread:

```ts
const control = SigChannel.fromWorker<any>(worker, "control");
control.postMessage("init");
const ready = await control.read();
```

Worker:

```ts
const control = SigChannel.fromWorkerContext<any>(self, "control");
await control.read();
control.postMessage("ready");
```

## Development

```bash
npm run test
npm run test:browser -- --run
npm run build
```

Browser tests use Vitest Browser + Playwright and validate worker-based replication behavior.
