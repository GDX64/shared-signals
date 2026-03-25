import { ComputedSignal, Signal } from "./reactive";
import type {
  ReadableSignal,
  SignalAsyncRequest,
  SignalChange,
  SignalOperation,
  SignalsChanges,
  SignalsState,
  WritableSignal,
} from "./types";

type SignalReference = {
  __sharedSignalRef: number;
};

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

  public applyOperation(operation: SignalOperation): void {
    if (operation.type === "set-async") {
      if (!this.allowSynchronousSet) {
        return;
      }

      const ackOperation: SignalChange = {
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
