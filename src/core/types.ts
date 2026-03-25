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

export type SignalAsyncRequest = {
  type: "set-async";
  id: number;
  value: unknown;
  requestID: number;
};

export type SignalOperation = SignalChange | SignalAsyncRequest;

export type SignalsChanges = {
  changes: SignalChange[];
};
