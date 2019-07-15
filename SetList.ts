export default class SetList<T> {
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
}
