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

class Signal<T> implements WritableSignal<T>, Dependency {
  public readonly id: number;
  private value: T;
  private readonly subscribers = new Set<ComputedSignal<unknown>>();

  public constructor(id: number, initialValue: T) {
    this.id = id;
    this.value = initialValue;
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
  private nextID = 1;

  public static create(): SignalsRoot {
    return new SignalsRoot();
  }

  public static fromState(state: SignalsState): SignalsRoot {
    const root = new SignalsRoot();
    root.nextID = state.nextID;

    for (const entry of state.values) {
      root.createSignalWithID(entry.id, entry.value);
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
      values.push({ id, value: signal.get() });
    }

    return {
      nextID: this.nextID,
      values,
    };
  }

  private createSignalWithID<T>(id: number, initialValue: T): Signal<T> {
    const signal = new Signal(id, initialValue);
    this.signalsByID.set(id, signal as Signal<unknown>);

    if (id >= this.nextID) {
      this.nextID = id + 1;
    }

    return signal;
  }
}
