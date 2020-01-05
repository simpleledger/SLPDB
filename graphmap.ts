import { GraphTxn, SlpTokenGraph, GraphTxnOutput } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo, TokenUtxoStatus, BatonUtxoStatus, TokenDBObject, TokenStatsDbo } from "./interfaces";
import { Decimal128 } from "mongodb";
import { Config } from "./config";
import { RpcClient } from "./rpc";

export class GraphMap extends Map<string, GraphTxn> {
    public pruned = new Map<string, GraphTxn>();
    private rootId: string;

    constructor(rootId: string) {
        super();
        this.rootId = rootId;
    }

    public dirtyItems() {
        return Array.from(this.values()).filter(i => i.isDirty);
    }

    public has(txid: string, includePrunedItems=false): boolean {
        if(includePrunedItems) {
            return super.has(txid) || this.pruned.has(txid);
        }
        return super.has(txid);
    }

    public get(txid: string, includePrunedItems=false): GraphTxn|undefined {
        if(includePrunedItems) {
            return super.get(txid) || this.pruned.get(txid);
        }
        return super.get(txid);
    }

    // TODO: Prune validator txns
    public prune(txid: string, pruneHeight: number) {
        if (this.has(txid) && txid !== this.rootId) {
            let gt = this.get(txid)!;
            gt.isDirty = true;
            gt.pruneHeight = pruneHeight;
            this.pruned.set(txid, gt);
            console.log(`Pruned ${txid} with prune height of ${pruneHeight} : ${this.delete(txid)}`);
            return true;
        }
        return false;
    }

    private flushPrunedItems() {
        const txids = Array.from(this.pruned.keys());
        this.pruned.forEach((i, txid) => {
            RpcClient.transactionCache.delete(txid);
            // NOTE: The following is not needed here becuase this cleared elsewhere
            // delete tg._slpValidator.cachedRawTransactions[txid];
        });

        this.pruned.clear();
        return txids;
    }

    public static toDbo(tg: SlpTokenGraph, recentBlocks: {hash: string, height: number}[]): [GraphTxnDbo[], TokenDBObject] {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);
        let itemsToUpdate: GraphTxnDbo[] = [];
        tg._graphTxns.forEach((g, txid) => {
            let pruneHeight = null;

            if (Config.db.pruning) {
                // Here we determine if a graph object should be marked as aged and spent,
                // this will prevent future loading of the object.  
                // We also unload the object from memory if pruning is true.
                const BLOCK_AGE_CUTOFF = 10;
                let isAgedAndSpent =
                    g.blockHash &&
                    recentBlocks.length > BLOCK_AGE_CUTOFF-1 &&
                    !recentBlocks.map(i => i.hash).includes(g.blockHash.toString("hex")) &&
                    !(g.outputs.filter(i => [ TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT ].includes(i.status)).length > 0);

                if (isAgedAndSpent) {
                    pruneHeight = recentBlocks[BLOCK_AGE_CUTOFF-1].height;
                }
            }

            if (g.isDirty) {
                let dbo: GraphTxnDbo = {
                    tokenDetails: { tokenIdHex: tokenDetails.tokenIdHex },
                    graphTxn: {
                        txid,
                        details: SlpTokenGraph.MapTokenDetailsToDbo(g.details, tg._tokenDetails.decimals),
                        outputs: GraphMap.txnOutputsToDbo(tg, g.outputs),
                        inputs: g.inputs.map((i) => {
                            return {
                                address: i.address,
                                txid: i.txid,
                                vout: i.vout,
                                bchSatoshis: i.bchSatoshis,
                                slpAmount: Decimal128.fromString(i.slpAmount.dividedBy(10**tg._tokenDetails.decimals).toFixed())
                            }
                        }),
                        blockHash: g.blockHash,
                        pruneHeight: pruneHeight ? pruneHeight : null
                    }
                };
                itemsToUpdate.push(dbo);
                g.isDirty = false;
            }
        });


        // canBePruned means it can be pruned at somepoint, regardless of whether output age (i.e., 10 blocks req for isAgedAndSpent)
        let canBePruned = Array.from(tg._graphTxns.values())
                            .flatMap(i => i.outputs)
                            .filter(i => 
                                [ TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT ].includes(i.status)
                            ).length < tg._graphTxns.size;
        
        // Do the pruning here
        itemsToUpdate.forEach(dbo => { if (dbo.graphTxn.pruneHeight) tg._graphTxns.prune(dbo.graphTxn.txid, dbo.graphTxn.pruneHeight)});
        if (tg._graphTxns.pruned.size > 0) {
            tg._isGraphPruned = true;
        } else {
            tg._isGraphPruned = !canBePruned;
        }
        tg._graphTxns.flushPrunedItems();

        let tokenDbo = GraphMap.tokenDetailstoDbo(tg);
        return [ itemsToUpdate, tokenDbo ];
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
