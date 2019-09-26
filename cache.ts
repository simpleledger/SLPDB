export class SetCache<T> {
    private set = new Set<T>()
    private list: T[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get length(): number {
        return this.list.length;
    }

    push(item: T) {
        this.set.add(item);
        this.list.push(item);
        if(this.set.size > this.maxSize) {
            this.shift();
        }
    }

    has(item: T) {
        return this.set.has(item);
    }

    shift(): T | undefined {
        let item = this.list.shift();
        if(item)
            this.set.delete(item);
        return item;
    }

    clear() {
        this.list = [];
        this.set.clear();
    }
}

export class MapCache<T, M> {
    private map = new Map<T, M>()
    private list: T[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
    }

    get length(): number {
        return this.list.length;
    }

    set(key: T, item: M) {
        this.list.push(key);
        this.map.set(key, item);
        if(this.map.size > this.maxSize) {
            this.shift();
        }
    }

    get(key: T) {
        return this.map.get(key);
    }

    has(key: T) {
        return this.map.has(key);
    }

    getMap() {
        return this.map;
    }

    private shift(): T | undefined {
        let key = this.list.shift();
        if(key)
            this.map.delete(key);
        return key;
    }

    clear() {
        this.list = [];
        this.map.clear();
    }
}
