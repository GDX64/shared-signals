import type { WritableSignal } from "./types";

export type MapSignalEntry<K, V> = {
  key: K;
  value: WritableSignal<V | undefined>;
};

export type MapSignalState<K, V> = {
  __mapSignal: true;
  entries: Array<MapSignalEntry<K, V>>;
};

export function createMapSignalState<K, V>(
  entries: Array<MapSignalEntry<K, V>>,
): MapSignalState<K, V> {
  return {
    __mapSignal: true,
    entries,
  };
}

export function isMapSignalState(
  value: unknown,
): value is MapSignalState<unknown, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("__mapSignal" in value) || value.__mapSignal !== true) {
    return false;
  }

  if (!("entries" in value) || !Array.isArray(value.entries)) {
    return false;
  }

  return true;
}

export class MapSignal<K, V> {
  private readonly records: Array<{
    key: K;
    value: WritableSignal<V | undefined>;
    persisted: boolean;
  }>;

  public constructor(
    private readonly stateSignal: WritableSignal<MapSignalState<K, V>>,
    private readonly createValueSignal: (
      initialValue: V | undefined,
    ) => WritableSignal<V | undefined>,
  ) {
    const initialState = this.stateSignal.get();
    this.records = initialState.entries.map((entry) => {
      return {
        key: entry.key,
        value: entry.value,
        persisted: true,
      };
    });
  }

  public get id(): number {
    return this.stateSignal.id;
  }

  public get(key: K): V | undefined {
    let record = this.findRecord(key);
    if (record === undefined) {
      this.syncFromState();
      record = this.findRecord(key);
    }

    if (record === undefined) {
      record = {
        key,
        value: this.createValueSignal(undefined),
        persisted: false,
      };
      this.records.push(record);
    }

    return record.value.get();
  }

  public set(key: K, value: V): void {
    let record = this.findRecord(key);
    if (record === undefined) {
      this.syncFromState();
      record = this.findRecord(key);
    }

    if (record !== undefined) {
      record.value.set(value);

      if (!record.persisted) {
        record.persisted = true;
        const state = this.stateSignal.get();
        this.stateSignal.set(
          createMapSignalState([
            ...state.entries,
            { key, value: record.value },
          ]),
        );
      }
      return;
    }

    const valueSignal = this.createValueSignal(value);
    this.records.push({ key, value: valueSignal, persisted: true });
    const state = this.stateSignal.get();
    this.stateSignal.set(
      createMapSignalState([...state.entries, { key, value: valueSignal }]),
    );
  }

  public async setAsync(key: K, value: V): Promise<void> {
    let record = this.findRecord(key);
    if (record === undefined) {
      this.syncFromState();
      record = this.findRecord(key);
    }

    if (record !== undefined) {
      await record.value.setAsync(value);

      if (!record.persisted) {
        record.persisted = true;
        const state = this.stateSignal.get();
        this.stateSignal.set(
          createMapSignalState([
            ...state.entries,
            { key, value: record.value },
          ]),
        );
      }
      return;
    }

    this.set(key, value);
  }

  public has(key: K): boolean {
    let record = this.findRecord(key);
    if (record === undefined) {
      this.syncFromState();
      record = this.findRecord(key);
    }

    return record !== undefined && record.value.get() !== undefined;
  }

  public delete(key: K): void {
    let record = this.findRecord(key);
    if (record === undefined) {
      this.syncFromState();
      record = this.findRecord(key);
    }

    if (record === undefined) {
      return;
    }

    record.value.set(undefined);
    record.persisted = false;

    const state = this.stateSignal.get();
    const filteredEntries = state.entries.filter(
      (entry) => !Object.is(entry.key, key),
    );

    if (filteredEntries.length === state.entries.length) {
      return;
    }

    this.stateSignal.set(createMapSignalState(filteredEntries));
  }

  private syncFromState(): void {
    const state = this.stateSignal.get();

    for (const entry of state.entries) {
      const existing = this.findRecord(entry.key);
      if (existing === undefined) {
        this.records.push({
          key: entry.key,
          value: entry.value,
          persisted: true,
        });
        continue;
      }

      existing.value = entry.value;
      existing.persisted = true;
    }

    for (const record of this.records) {
      if (!record.persisted) {
        continue;
      }

      const stillPersisted = state.entries.some((entry) => {
        return Object.is(entry.key, record.key);
      });

      if (!stillPersisted) {
        record.persisted = false;
      }
    }
  }

  private findRecord(key: K):
    | {
        key: K;
        value: WritableSignal<V | undefined>;
        persisted: boolean;
      }
    | undefined {
    for (const record of this.records) {
      if (Object.is(record.key, key)) {
        return record;
      }
    }

    return undefined;
  }
}
