type Txo = string;
type TokenId = Buffer;

class GlobalUtxoSet extends Map<Txo, TokenId> {
    public static Instance() {
        return this._instance || (this._instance = new GlobalUtxoSet());
    }
    private static _instance: GlobalUtxoSet;

    public get(key: string): Buffer | undefined {
        if (this.size % 1000) {
            console.log(`UTXO size: ${this.size}`);
        }
        return super.get(key);
    }
    private constructor() { super(); }
}

// accessor to a singleton utxo set
export const slpUtxos = GlobalUtxoSet.Instance;
