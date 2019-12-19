import { GraphTxn, SlpTokenGraph, GraphTxnOutput } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo } from "./interfaces";
import { Decimal128 } from "mongodb";

export class GraphMap extends Map<string, GraphTxn> {
    public deleted = new Map<string, GraphTxn>();

    public dirtyItems() {
        return Array.from(this.values()).filter(i => i.isDirty);
    }

    public has(txid: string, includeDeletedItems=false): boolean {
        if(includeDeletedItems) {
            return super.has(txid) || this.deleted.has(txid);
        }
        console.log(`Has: ${super.has(txid)}`)
        return super.has(txid);
    }

    public delete(txid: string) {
        if(this.has(txid)) {
            this.deleted.set(txid, this.get(txid)!);
            console.log(`Delete: ${super.delete(txid)}`);
            return true;
        }
        return false;
    }

    private _deletedTxids() {
        const txids = Array.from(this.deleted.keys());
        this._flush();
        return txids;
    }

    private _flush() {
        this.deleted.clear();
        this.forEach(i => i.isDirty = true);

        // TODO: prune items which can no longer be updated
    }

    public static toDbo(tg: SlpTokenGraph): [GraphTxnDbo[], string[]] { //, recentBlocks: string[]): GraphTxnDbo[] {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);
        let itemsToUpdate: GraphTxnDbo[] = [];
        tg._graphTxns.forEach((g, txid) => {
            if(g.isDirty) {
                let dbo: GraphTxnDbo = {
                    tokenDetails: { tokenIdHex: tokenDetails.tokenIdHex }, 
                    graphTxn: {
                        txid,
                        details: SlpTokenGraph.MapTokenDetailsToDbo(tg._graphTxns.get(txid)!.details, tg._tokenDetails.decimals),
                        outputs: GraphMap.outputsToDbo(tg, tg._graphTxns.get(txid)!.outputs),
                        inputs: tg._graphTxns.get(txid)!.inputs.map((i) => { 
                            return {
                                address: i.address,
                                txid: i.txid,
                                vout: i.vout,
                                bchSatoshis: i.bchSatoshis,
                                slpAmount: Decimal128.fromString(i.slpAmount.dividedBy(10**tg._tokenDetails.decimals).toFixed())
                            }
                        }),
                        stats: g.stats,
                        blockHash: g.blockHash
                    }
                };
                itemsToUpdate.push(dbo);
            }
        });
        let itemsToDelete = tg._graphTxns._deletedTxids();
        return [itemsToUpdate, itemsToDelete ];
    }

    public static outputsToDbo(tokenGraph: SlpTokenGraph, outputs: GraphTxnOutput[]): GraphTxnOutputDbo[] {
        let mapped: GraphTxnDetailsDbo["outputs"] = [];
        outputs.forEach(o => {
                let m = Object.create(o);
                //console.log(m);
                try {
                    m.slpAmount = Decimal128.fromString(m.slpAmount.dividedBy(10**tokenGraph._tokenDetails.decimals).toFixed());
                } catch(_) {
                    m.slpAmount = Decimal128.fromString("0");
                }
                mapped.push(m);
        })
        return mapped;
    }
}
