import type { ReadableSignal, WritableSignal } from "./types";

type Dependency = {
  addSubscriber(subscriber: ComputedSignal<unknown>): void;
  removeSubscriber(subscriber: ComputedSignal<unknown>): void;
};

let activeComputed: ComputedSignal<unknown> | null = null;

export class Signal<T> implements WritableSignal<T>, Dependency {
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

export class ComputedSignal<T> implements ReadableSignal<T>, Dependency {
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
