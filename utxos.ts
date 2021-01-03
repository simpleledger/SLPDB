type Txo = string;
type TokenId = Buffer;

class GlobalUtxoSet extends Map<Txo, TokenId> {
    public static Instance() {
        return this._instance || (this._instance = new GlobalUtxoSet());
    }
    private static _instance: GlobalUtxoSet;

    public set(key: string, value: Buffer): this {
        if (this.size % 100000 === 0) {
            console.log(`UTXO size: ${this.size}`);
        }
        return super.set(key, value);
    }
    private constructor() { super(); }
}

// accessor to a singleton utxo set
export const slpUtxos = GlobalUtxoSet.Instance;
