export default class SetList<T> extends Set {
    private list: T[] = [];
    private maxSize: number;

    constructor(maxSize: number) {
        super();
        this.maxSize = maxSize;
    }

    get length(): number {
        return this.list.length;
    }

    push(item: T) {
        this.add(item);
        this.list.push(item);

        if(this.size > this.maxSize) {
            this.shift();
        }
    }

    shift(): T | undefined {
        let item = this.list.shift();
        if(item)
            this.delete(item);
        return item;
    }
}
