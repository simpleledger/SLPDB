export class CacheSet<T> {
    private set = new Set<T>()
    private list: T[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    [Symbol.iterator]() {
        return this.list.values();
    }

    get length(): number {
        return this.list.length;
    }

    push(item: T) {
        this.set.add(item);
        if (this.maxSize > 0 && this.set.size > this.maxSize) {
            this.shift();
        }
        return this.list.push(item);
    }

    has(item: T) {
        return this.set.has(item);
    }

    delete(item: T) {
        if (this.set.delete(item)) {
            this.list = this.list.filter(k => k !== item);
        }
    }

    toSet() {
        return this.set;
    }

    shift(): T | undefined {
        let item = this.list.shift();
        if (item) {
            this.set.delete(item);
        }
        return item;
    }

    pop(): T | undefined {
        let item = this.list.pop();
        if (item) {
            this.set.delete(item);
        }
        return item;
    }

    clear() {
        this.list = [];
        this.set.clear();
    }
}

export class CacheMap<T, M> {
    private map = new Map<T, M>()
    private list: T[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    [Symbol.iterator]() {
        return this.items();
    }

    get length(): number {
        return this.list.length;
    }

    get size(): number {
        return this.list.length;
    }

    values(): IterableIterator<M> {
        let l: M[] = this.list.map(i => this.map.get(i)!);
        return l.values();
    }

    keys(): IterableIterator<T> {
        return this.list.values();
    }

    items(): IterableIterator<[T,M]> {
        let l: [T,M][] = this.list.map(i => [i, this.map.get(i)!]);
        return l.values();
    }

    set(key: T, item: M) {
        this.list.push(key);
        this.map.set(key, item);
        if(this.maxSize > 0 && this.map.size > this.maxSize) {
            this.shift();
        }
    }

    get(key: T) {
        return this.map.get(key);
    }

    has(key: T) {
        return this.map.has(key);
    }

    delete(key: T) {
        if (this.map.delete(key)) {
            this.list = this.list.filter(k => k !== key);
        }
    }

    toMap() {
        return this.map;
    }

    private shift(): T | undefined {
        let key = this.list.shift();
        if(key) {
            this.map.delete(key);
        }
        return key;
    }

    clear() {
        this.list = [];
        this.map.clear();
    }
}
