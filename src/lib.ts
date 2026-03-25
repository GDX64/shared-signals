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
};

export type SignalsState = {
  nextID: number;
  values: Array<{ id: number; value: unknown }>;
};

export type SignalChange =
  | { type: "create"; id: number; value: unknown }
  | { type: "set"; id: number; value: unknown };

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

  public constructor(
    id: number,
    initialValue: T,
    onSet?: (id: number, value: unknown) => void,
  ) {
    this.id = id;
    this.value = initialValue;
    this.onSet = onSet;
  }

  public get(): T {
    if (activeComputed !== null) {
      this.addSubscriber(activeComputed);
      activeComputed.addDependency(this);
    }

    return this.value;
  }

  public set(value: T): void {
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
  private nextID = 1;

  public static create(): SignalsRoot {
    return new SignalsRoot();
  }

  public static fromState(state: SignalsState): SignalsRoot {
    const root = new SignalsRoot();
    root.nextID = state.nextID;

    for (const entry of state.values) {
      root.createSignalWithID(entry.id, undefined);
    }

    for (const entry of state.values) {
      const signal = root.fromID<unknown>(entry.id);
      signal.set(root.deserializeValue(entry.value));
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
          (signal as WritableSignal<unknown>).set(value);
        }
        continue;
      }

      const existing = this.signalsByID.get(change.id);
      if (existing === undefined) {
        this.createSignalWithID(change.id, value);
        continue;
      }

      (existing as WritableSignal<unknown>).set(value);
    }
  }

  private createSignalWithID<T>(id: number, initialValue: T): Signal<T> {
    const signal = new Signal(id, initialValue, (signalID, value) => {
      this.pushChange({ type: "set", id: signalID, value });
    });
    this.signalsByID.set(id, signal as Signal<unknown>);
    this.pushChange({ type: "create", id, value: initialValue });

    if (id >= this.nextID) {
      this.nextID = id + 1;
    }

    return signal;
  }

  private pushChange(change: SignalChange): void {
    const serializedChange: SignalChange = {
      ...change,
      value: this.serializeValue(change.value),
    };

    for (const recorder of this.changeRecorders) {
      recorder.changes.push(serializedChange);
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
