type QueueState<T> = {
  readonly messages: T[];
  readonly waiters: Array<(value: T) => void>;
  readonly listeners: Set<(value: T) => void>;
};

type MessageEventSource<T> = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<T>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<T>) => void,
  ): void;
};

type MessageEventTarget<T> = {
  postMessage(message: T): void;
};

export type SigPort<T> = {
  postMessage(message: T): void;
  read(): Promise<T>;
  onMessage(listener: (message: T) => void): () => void;
};

type SigChannelEnvelope = {
  __sig_channel: true;
  channel: string;
  payload: unknown;
};

function isSigChannelEnvelope(value: unknown): value is SigChannelEnvelope {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("__sig_channel" in value) || value.__sig_channel !== true) {
    return false;
  }

  if (!("channel" in value) || typeof value.channel !== "string") {
    return false;
  }

  return "payload" in value;
}

class InMemoryPort<T> implements SigPort<T> {
  public constructor(
    private readonly targetQueue: QueueState<T>,
    private readonly ownQueue: QueueState<T>,
  ) {}

  public postMessage(message: T): void {
    const waiter = this.targetQueue.waiters.shift();
    if (waiter !== undefined) {
      waiter(message);
    } else {
      this.targetQueue.messages.push(message);
    }

    for (const listener of this.targetQueue.listeners) {
      listener(message);
    }
  }

  public read(): Promise<T> {
    if (this.ownQueue.messages.length > 0) {
      return Promise.resolve(this.ownQueue.messages.shift() as T);
    }

    return new Promise<T>((resolve) => {
      this.ownQueue.waiters.push(resolve);
    });
  }

  public onMessage(listener: (message: T) => void): () => void {
    this.ownQueue.listeners.add(listener);

    return () => {
      this.ownQueue.listeners.delete(listener);
    };
  }
}

class EventPort<T> implements SigPort<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<(value: T) => void> = [];
  private readonly onSourceMessage: (event: MessageEvent<unknown>) => void;
  private readonly listeners = new Set<(message: T) => void>();

  public constructor(
    private readonly target: MessageEventTarget<unknown>,
    source: MessageEventSource<unknown>,
    private readonly channel: string,
  ) {
    this.onSourceMessage = (event) => {
      if (!isSigChannelEnvelope(event.data)) {
        return;
      }

      if (event.data.channel !== this.channel) {
        return;
      }

      const message = event.data.payload as T;
      const waiter = this.waiters.shift();
      if (waiter !== undefined) {
        waiter(message);
      } else {
        this.queue.push(message);
      }

      for (const listener of this.listeners) {
        listener(message);
      }
    };

    source.addEventListener("message", this.onSourceMessage);
  }

  public postMessage(message: T): void {
    this.target.postMessage({
      __sig_channel: true,
      channel: this.channel,
      payload: message,
    } satisfies SigChannelEnvelope);
  }

  public read(): Promise<T> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift() as T);
    }

    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  public onMessage(listener: (message: T) => void): () => void {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class SigChannel<T> {
  public readonly p1: SigPort<T>;
  public readonly p2: SigPort<T>;

  public static fromWorker<T = any>(
    worker: Worker,
    channel: string,
  ): SigPort<T> {
    return new EventPort<T>(worker, worker, channel);
  }

  public static fromWorkerContext<T = any>(
    context: MessageEventSource<unknown> & MessageEventTarget<unknown>,
    channel: string,
  ): SigPort<T> {
    return new EventPort<T>(context, context, channel);
  }

  public constructor(_name?: string) {
    const q1: QueueState<T> = {
      messages: [],
      waiters: [],
      listeners: new Set(),
    };
    const q2: QueueState<T> = {
      messages: [],
      waiters: [],
      listeners: new Set(),
    };

    this.p1 = new InMemoryPort(q2, q1);
    this.p2 = new InMemoryPort(q1, q2);
  }
}
