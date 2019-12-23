import { GraphTxn, SlpTokenGraph, GraphTxnOutput } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo, TokenUtxoStatus, BatonUtxoStatus, TokenDBObject, TokenStatsDbo } from "./interfaces";
import { Decimal128 } from "mongodb";
import { Config } from "./config";
import { RpcClient } from "./rpc";

export class GraphMap extends Map<string, GraphTxn> {
    public deleted = new Map<string, GraphTxn>();

    public dirtyItems() {
        return Array.from(this.values()).filter(i => i.isDirty);
    }

    public has(txid: string, includeDeletedItems=false): boolean {
        if(includeDeletedItems) {
            return super.has(txid) || this.deleted.has(txid);
        }
        //console.log(`Has: ${super.has(txid)}`);
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

    // TODO: Prune validator txns
    public prune(txid: string) {
        console.log(`Pruned ${txid}: ${super.delete(txid)}`);
        RpcClient.transactionCache.delete(txid);
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

    public static toDbo(tg: SlpTokenGraph, recentBlocks: string[]): [GraphTxnDbo[], string[], TokenDBObject] {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);
        let itemsToUpdate: GraphTxnDbo[] = [];
        let itemsToPrune = new Set<string>();
        tg._graphTxns.forEach((g, txid) => {

            // Here we determine if a graph object should be marked as aged and spent,
            // this will prevent future loading of the object.  
            // We also unload the object from memory if pruning is true.
            let isAgedAndSpent = 
                recentBlocks.length >= 10 &&
                !(g.blockHash && recentBlocks.includes(g.blockHash.toString("hex"))) &&
                !(g.outputs.filter(i => [TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT].includes(i.status)).length > 0)

            if(g.isDirty || isAgedAndSpent) {
                let dbo: GraphTxnDbo = {
                    tokenDetails: { tokenIdHex: tokenDetails.tokenIdHex },
                    graphTxn: {
                        txid,
                        details: SlpTokenGraph.MapTokenDetailsToDbo(tg._graphTxns.get(txid)!.details, tg._tokenDetails.decimals),
                        outputs: GraphMap.txnOutputsToDbo(tg, tg._graphTxns.get(txid)!.outputs),
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
                        blockHash: g.blockHash,
                        isAgedAndSpent
                    }
                };
                itemsToUpdate.push(dbo);
            }

            if (isAgedAndSpent) {
                itemsToPrune.add(txid);
            }
        });

        // NOTE: because we have this logic/interaction with token details DBO this method MUST be run before the token DBO commit
        if (Config.db.pruning) {
            itemsToPrune.forEach(txid => tg._graphTxns.prune(txid));
            tg._isGraphPruned = true;
        } else if (itemsToPrune.size > 0) {
            tg._isGraphPruned = false;
        }
        let tokenDbo = GraphMap.tokenDetailstoDbo(tg);

        let itemsToDelete = tg._graphTxns._deletedTxids();
        return [ itemsToUpdate, itemsToDelete, tokenDbo ];
    }

    public static tokenDetailstoDbo(graph: SlpTokenGraph): TokenDBObject {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(graph._tokenDetails, graph._tokenDetails.decimals);

        if (!Config.db.pruning) {
            graph._isGraphPruned = false;
        }

        let result: TokenDBObject = {
            schema_version: Config.db.token_schema_version,
            isGraphPruned: graph._isGraphPruned,
            lastUpdatedBlock: graph._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            mintBatonUtxo: graph._mintBatonUtxo,
            tokenStats: GraphMap.mapTokenStatstoDbo(graph),
        }
        if(graph._nftParentId) {
            result.nftParentId = graph._nftParentId;
        }
        return result;
    }

    public static txnOutputsToDbo(tokenGraph: SlpTokenGraph, outputs: GraphTxnOutput[]): GraphTxnOutputDbo[] {
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

    public static mapTokenStatstoDbo(graph: SlpTokenGraph): TokenStatsDbo {
        return {
            block_created: graph._tokenStats.block_created,
            block_last_active_send: graph._tokenStats.block_last_active_send,
            block_last_active_mint: graph._tokenStats.block_last_active_mint,
            qty_valid_txns_since_genesis: graph._tokenStats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: graph._tokenStats.qty_valid_token_utxos,
            qty_valid_token_addresses: graph._tokenStats.qty_valid_token_addresses,
            qty_token_minted: Decimal128.fromString(graph._tokenStats.qty_token_minted.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
            qty_token_burned: Decimal128.fromString(graph._tokenStats.qty_token_burned.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
            qty_token_circulating_supply: Decimal128.fromString(graph._tokenStats.qty_token_circulating_supply.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
            qty_satoshis_locked_up: graph._tokenStats.qty_satoshis_locked_up,
            minting_baton_status: graph._tokenStats.minting_baton_status
        }
    }
}
