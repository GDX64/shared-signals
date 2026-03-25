type Dependency = {
  addSubscriber(subscriber: ComputedSignal<unknown>): void;
  removeSubscriber(subscriber: ComputedSignal<unknown>): void;
};

let activeComputed: ComputedSignal<unknown> | null = null;

export type ReadableSignal<T> = {
  get(): T;
};

export type WritableSignal<T> = ReadableSignal<T> & {
  set(value: T): void;
};

class Signal<T> implements WritableSignal<T>, Dependency {
  private value: T;
  private readonly subscribers = new Set<ComputedSignal<unknown>>();

  public constructor(initialValue: T) {
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
  public static create(): SignalsRoot {
    return new SignalsRoot();
  }

  public static computed<T>(compute: () => T): ReadableSignal<T> {
    return new ComputedSignal(compute);
  }

  public signal<T>(initialValue: T): WritableSignal<T> {
    return new Signal(initialValue);
  }

  public computed<T>(compute: () => T): ReadableSignal<T> {
    return SignalsRoot.computed(compute);
  }
}
