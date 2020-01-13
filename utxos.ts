type Txo = string;
type TokenId = Buffer;

class GlobalUtxoSet extends Map<Txo, TokenId> {
    public static Instance() {
        return this._instance || (this._instance = new GlobalUtxoSet());
    }
    private static _instance: GlobalUtxoSet;
    private constructor() { super(); }
}

// accessor to a singleton utxo set
export const slpUtxos = GlobalUtxoSet.Instance;
