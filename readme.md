## Shared Heap

Shared Heap is a library for sharing data between threads in JavaScript. It provides a simple API for creating and manipulating shared objects, and it handles the underlying memory management and synchronization.

## Installation

```bash
npm install @glmachado/shared-heap
```

## Basic Usage

### Creating Objects

```typescript
import { SharedHeap } from "@glmachado/shared-heap";

const db = await SharedHeap.create();

// Create a simple object
const obj = db.createObject({
  foo: 10,
  bar: 10.1,
  baz: "hello",
  qux: new Uint8Array([1, 2, 3]),
});

console.log(obj.foo); // 10
console.log(obj.bar); // 10.1
console.log(obj.baz); // "hello"
console.log(obj.qux); // Uint8Array([1, 2, 3])
```

## Supported Types
Shared Heap supports the following types:
- Primitives: `number`, `string`, `boolean`, `null`
- Typed arrays: `Uint8Array`
- Nested objects and arrays (with supported types)
- References to other shared objects


## Cross-Thread Sharing

Share objects between threads using Web Workers with thread-safe operations:

### Main Thread

```typescript
import { SharedHeap } from "@glmachado/shared-heap";
import Worker from "./worker?worker";

const db = await SharedHeap.create();

// Create a shared counter object
const counter = db.createObject({ value: 0 });

// Get the object ID to share with workers
const counterID = SharedHeap.getIDOfProxy(counter);

// Create worker data that can be transferred
const workerData = db.createWorker();

// Spawn multiple workers
const N = 10_000; // operations per worker
const N_WORKERS = 4;

const workers = Array.from({ length: N_WORKERS }, () => {
  const worker = new Worker();
  worker.postMessage({ counterID, workerData, N });
  
  return new Promise((resolve) => {
    worker.onmessage = (event) => resolve(event.data);
  });
});

await Promise.all(workers);

console.log(counter.value); // 40000 (10000 * 4 workers)
```

### Worker Thread

```typescript
import { SharedHeap } from "@glmachado/shared-heap";

self.onmessage = async (event) => {
  const { N, workerData, counterID } = event.data;

  // Connect to the shared heap
  const db = await SharedHeap.fromModule(workerData);
  
  // Get the shared counter object
  const counter = db.getObject<{ value: number }>(counterID)!;

  // Perform thread-safe operations
  for (let i = 0; i < N; i++) {
    db.withLock(() => {
      counter.value += 1;
    });
  }

  self.postMessage("done");
};
```

### Thread Safety

Use `withLock()` to ensure atomic operations across threads:

```typescript
// Thread-safe increment
db.withLock(() => {
  counter.value += 1;
});

// Thread-safe complex operations
db.withLock(() => {
  const current = counter.value;
  counter.value = current * 2 + 1;
});
```

## Memory Management

### Automatic Reference Counting

Shared Heap uses automatic reference counting to manage memory:

```typescript
const db = await SharedHeap.create();
const obj = db.createObject({
  child: { name: "child" },
  child2: { name: "child2" },
});

console.log(db.getReferenceCount(obj)); // 1

const child = obj.child;
const child2 = obj.child2;

// Two references: one in obj, one in the child variable
console.log(db.getReferenceCount(child)); // 2
console.log(db.getReferenceCount(child2)); // 2
```



## Features

- ✅ Automatic memory management with reference counting
- ✅ Support for primitives, objects, arrays, and typed arrays
- ✅ Nested object structures
- ✅ Cross-thread data sharing
- ✅ Thread-safe operations with locks
- ✅ Type-safe TypeScript API

## License

MIT