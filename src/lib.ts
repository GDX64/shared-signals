export { SigChannel } from "./SigChannel";

type Dependency = {
  addSubscriber(subscriber: ComputedSignal<unknown>): void;
  removeSubscriber(subscriber: ComputedSignal<unknown>): void;
};

let activeComputed: ComputedSignal<unknown> | null = null;

export type ReadableSignal<T> = {
  get(): T;
};

export type WritableSignal<T> = ReadableSignal<T> & {
  readonly id: number;
  set(value: T): void;
  setAsync(value: T): Promise<void>;
};

export type SignalsState = {
  nextID: number;
  values: Array<{ id: number; value: unknown }>;
};

export type SignalChange =
  | { type: "create"; id: number; value: unknown }
  | { type: "set"; id: number; value: unknown; requestID?: number };

export type SignalOperation = SignalChange;
export type SignalAsyncRequest = {
  type: "set-async";
  id: number;
  value: unknown;
  requestID: number;
};

export type SignalsChanges = {
  changes: SignalChange[];
};

type SignalReference = {
  __sharedSignalRef: number;
};

class Signal<T> implements WritableSignal<T>, Dependency {
  public readonly id: number;
  private value: T;
  private readonly subscribers = new Set<ComputedSignal<unknown>>();
  private readonly onSet?: (id: number, value: unknown) => void;
  private readonly onAsyncSet?: (id: number, value: unknown) => Promise<void>;
  private readonly canSetSynchronously: () => boolean;

  public constructor(
    id: number,
    initialValue: T,
    canSetSynchronously: () => boolean,
    onSet?: (id: number, value: unknown) => void,
    onAsyncSet?: (id: number, value: unknown) => Promise<void>,
  ) {
    this.id = id;
    this.value = initialValue;
    this.canSetSynchronously = canSetSynchronously;
    this.onSet = onSet;
    this.onAsyncSet = onAsyncSet;
  }

  public get(): T {
    if (activeComputed !== null) {
      this.addSubscriber(activeComputed);
      activeComputed.addDependency(this);
    }

    return this.value;
  }

  public set(value: T): void {
    if (!this.canSetSynchronously()) {
      throw new Error("Synchronous writes are disabled for this signal root.");
    }

    this.setWithoutGuards(value);
  }

  public async setAsync(value: T): Promise<void> {
    if (this.onAsyncSet !== undefined) {
      await this.onAsyncSet(this.id, value);
      return;
    }

    await Promise.resolve();
    this.setWithoutGuards(value);
  }

  public setFromOperation(value: T): void {
    this.setWithoutGuards(value);
  }

  private setWithoutGuards(value: T): void {
    if (Object.is(this.value, value)) {
      return;
    }

    this.value = value;
    this.onSet?.(this.id, value);

    for (const subscriber of this.subscribers) {
      subscriber.markDirty();
    }
  }

  public addSubscriber(subscriber: ComputedSignal<unknown>): void {
    this.subscribers.add(subscriber);
  }

  public removeSubscriber(subscriber: ComputedSignal<unknown>): void {
    this.subscribers.delete(subscriber);
  }
}

class ComputedSignal<T> implements ReadableSignal<T>, Dependency {
  private readonly subscribers = new Set<ComputedSignal<unknown>>();
  private readonly dependencies = new Set<Dependency>();
  private value!: T;
  private dirty = true;
  private evaluating = false;

  public constructor(private readonly compute: () => T) {}

  public get(): T {
    if (activeComputed !== null) {
      this.addSubscriber(activeComputed);
      activeComputed.addDependency(this);
    }

    if (this.dirty) {
      this.evaluate();
    }

    return this.value;
  }

  public addDependency(dependency: Dependency): void {
    this.dependencies.add(dependency);
  }

  public markDirty(): void {
    if (this.dirty) {
      return;
    }

    this.dirty = true;

    for (const subscriber of this.subscribers) {
      subscriber.markDirty();
    }
  }

  public addSubscriber(subscriber: ComputedSignal<unknown>): void {
    this.subscribers.add(subscriber);
  }

  public removeSubscriber(subscriber: ComputedSignal<unknown>): void {
    this.subscribers.delete(subscriber);
  }

  private evaluate(): void {
    if (this.evaluating) {
      throw new Error("Circular computed dependency detected.");
    }

    this.evaluating = true;

    for (const dependency of this.dependencies) {
      dependency.removeSubscriber(this);
    }
    this.dependencies.clear();

    const previousComputed = activeComputed;
    activeComputed = this;

    try {
      this.value = this.compute();
      this.dirty = false;
    } finally {
      activeComputed = previousComputed;
      this.evaluating = false;
    }
  }
}

export class SignalsRoot {
  private readonly signalsByID = new Map<number, Signal<unknown>>();
  private readonly changeRecorders = new Set<SignalsChanges>();
  private readonly operationListeners = new Set<
    (operation: SignalOperation) => void
  >();
  private readonly asyncRequestListeners = new Set<
    (request: SignalAsyncRequest) => void
  >();
  private suppressRecording = false;
  private activeRequestID: number | undefined = undefined;
  private nextRequestID = 1;
  private readonly pendingAsyncRequests = new Map<number, () => void>();
  private nextID = 1;

  private constructor(
    private readonly allowSynchronousSet: boolean,
    private readonly emitLocalOperations: boolean,
  ) {}

  public static create(): SignalsRoot {
    return new SignalsRoot(true, true);
  }

  public static fromState(state: SignalsState): SignalsRoot {
    const root = new SignalsRoot(false, false);
    root.nextID = state.nextID;

    for (const entry of state.values) {
      root.createSignalWithID(entry.id, undefined);
    }

    for (const entry of state.values) {
      const signal = root.signalsByID.get(entry.id);
      if (signal !== undefined) {
        signal.setFromOperation(root.deserializeValue(entry.value));
      }
    }

    return root;
  }

  public static computed<T>(compute: () => T): ReadableSignal<T> {
    return new ComputedSignal(compute);
  }

  public signal<T>(initialValue: T): WritableSignal<T> {
    const id = this.nextID;
    this.nextID += 1;

    return this.createSignalWithID(id, initialValue);
  }

  public computed<T>(compute: () => T): ReadableSignal<T> {
    return SignalsRoot.computed(compute);
  }

  public fromID<T>(id: number): WritableSignal<T> {
    const signal = this.signalsByID.get(id);

    if (signal === undefined) {
      throw new Error(`Signal with id ${id} was not found.`);
    }

    return signal as WritableSignal<T>;
  }

  public copyState(): SignalsState {
    const values: Array<{ id: number; value: unknown }> = [];

    for (const [id, signal] of this.signalsByID) {
      values.push({ id, value: this.serializeValue(signal.get()) });
    }

    return {
      nextID: this.nextID,
      values,
    };
  }

  public recordChanges(): SignalsChanges {
    const recorder: SignalsChanges = {
      changes: [],
    };

    this.changeRecorders.add(recorder);
    return recorder;
  }

  public onChange(listener: (operation: SignalOperation) => void): () => void {
    if (!this.emitLocalOperations) {
      throw new Error("Replicas cannot emit onChange events.");
    }

    this.operationListeners.add(listener);

    return () => {
      this.operationListeners.delete(listener);
    };
  }

  public onAsyncRequest(
    listener: (request: SignalAsyncRequest) => void,
  ): () => void {
    if (this.allowSynchronousSet) {
      throw new Error("Only replicas can emit async requests.");
    }

    this.asyncRequestListeners.add(listener);

    return () => {
      this.asyncRequestListeners.delete(listener);
    };
  }

  public applyOperation(operation: SignalOperation | SignalAsyncRequest): void {
    if (operation.type === "set-async") {
      if (!this.allowSynchronousSet) {
        return;
      }

      const ackOperation: SignalOperation = {
        type: "set",
        id: operation.id,
        value: operation.value,
        requestID: operation.requestID,
      };

      for (const listener of this.operationListeners) {
        listener(ackOperation);
      }
      return;
    }

    const value = this.deserializeValue(operation.value);
    this.suppressRecording = true;
    this.activeRequestID =
      operation.type === "set" ? operation.requestID : undefined;

    try {
      if (operation.type === "create") {
        if (!this.signalsByID.has(operation.id)) {
          this.createSignalWithID(operation.id, value);
          return;
        }

        const existing = this.signalsByID.get(operation.id);
        if (existing !== undefined) {
          existing.setFromOperation(value);
        }
        return;
      }

      const existing = this.signalsByID.get(operation.id);
      if (existing === undefined) {
        this.createSignalWithID(operation.id, value);
        return;
      }

      existing.setFromOperation(value);

      if (operation.requestID !== undefined) {
        const resolve = this.pendingAsyncRequests.get(operation.requestID);
        if (resolve !== undefined) {
          this.pendingAsyncRequests.delete(operation.requestID);
          resolve();
        }
      }
    } finally {
      this.activeRequestID = undefined;
      this.suppressRecording = false;
    }
  }

  public applyChanges(changes: SignalsChanges): void {
    for (const change of changes.changes) {
      const value = this.deserializeValue(change.value);

      if (change.type === "create") {
        if (!this.signalsByID.has(change.id)) {
          this.createSignalWithID(change.id, value);
          continue;
        }

        const signal = this.signalsByID.get(change.id);
        if (signal !== undefined) {
          signal.setFromOperation(value);
        }
        continue;
      }

      const existing = this.signalsByID.get(change.id);
      if (existing === undefined) {
        this.createSignalWithID(change.id, value);
        continue;
      }

      existing.setFromOperation(value);
    }
  }

  private createSignalWithID<T>(id: number, initialValue: T): Signal<T> {
    const signal = new Signal(
      id,
      initialValue,
      () => {
        return this.allowSynchronousSet;
      },
      (signalID, value) => {
        this.pushChange({ type: "set", id: signalID, value });
      },
      (signalID, value) => {
        return this.pushAsyncRequest({
          type: "set-async",
          id: signalID,
          value,
        });
      },
    );
    this.signalsByID.set(id, signal as Signal<unknown>);
    this.pushChange({ type: "create", id, value: initialValue });

    if (id >= this.nextID) {
      this.nextID = id + 1;
    }

    return signal;
  }

  private pushAsyncRequest(
    request: Omit<SignalAsyncRequest, "requestID">,
  ): Promise<void> {
    if (this.allowSynchronousSet) {
      return Promise.resolve();
    }

    const requestID = this.nextRequestID;
    this.nextRequestID += 1;

    const serializedRequest: SignalAsyncRequest = {
      ...request,
      requestID,
      value: this.serializeValue(request.value),
    };

    const promise = new Promise<void>((resolve) => {
      this.pendingAsyncRequests.set(requestID, resolve);
    });

    for (const listener of this.asyncRequestListeners) {
      listener(serializedRequest);
    }

    return promise;
  }

  private pushChange(change: SignalChange): void {
    const serializedChange: SignalChange = {
      ...change,
      ...(change.type === "set" && this.activeRequestID !== undefined
        ? { requestID: this.activeRequestID }
        : {}),
      value: this.serializeValue(change.value),
    };

    if (!this.suppressRecording) {
      for (const recorder of this.changeRecorders) {
        recorder.changes.push(serializedChange);
      }
    }

    if (!this.emitLocalOperations) {
      return;
    }

    for (const listener of this.operationListeners) {
      listener(serializedChange);
    }
  }

  private serializeValue(
    value: unknown,
    visited = new WeakMap<object, unknown>(),
  ): unknown {
    if (value instanceof Signal) {
      return {
        __sharedSignalRef: value.id,
      } satisfies SignalReference;
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    const cached = visited.get(value);
    if (cached !== undefined) {
      return cached;
    }

    if (Array.isArray(value)) {
      const arrayResult: unknown[] = [];
      visited.set(value, arrayResult);

      for (const item of value) {
        arrayResult.push(this.serializeValue(item, visited));
      }

      return arrayResult;
    }

    const result = Object.create(Object.getPrototypeOf(value)) as Record<
      string,
      unknown
    >;
    visited.set(value, result);

    for (const [key, item] of Object.entries(value)) {
      result[key] = this.serializeValue(item, visited);
    }

    return result;
  }

  private deserializeValue(
    value: unknown,
    visited = new WeakMap<object, unknown>(),
  ): unknown {
    if (this.isSignalReference(value)) {
      return this.fromID(value.__sharedSignalRef);
    }

    if (typeof value !== "object" || value === null) {
      return value;
    }

    const cached = visited.get(value);
    if (cached !== undefined) {
      return cached;
    }

    if (Array.isArray(value)) {
      const arrayResult: unknown[] = [];
      visited.set(value, arrayResult);

      for (const item of value) {
        arrayResult.push(this.deserializeValue(item, visited));
      }

      return arrayResult;
    }

    const result = Object.create(Object.getPrototypeOf(value)) as Record<
      string,
      unknown
    >;
    visited.set(value, result);

    for (const [key, item] of Object.entries(value)) {
      result[key] = this.deserializeValue(item, visited);
    }

    return result;
  }

  private isSignalReference(value: unknown): value is SignalReference {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    if (!("__sharedSignalRef" in value)) {
      return false;
    }

    return typeof value.__sharedSignalRef === "number";
  }
}
