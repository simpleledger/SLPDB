import { SlpTokenGraph } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo, TokenUtxoStatus, BatonUtxoStatus, TokenDBObject, TokenStatsDbo, TokenBatonStatus, GraphTxnInput, GraphTxnOutput, GraphTxn } from "./interfaces";
import { Decimal128 } from "mongodb";
import { Config } from "./config";
import { RpcClient } from "./rpc";
import { SlpTransactionType } from "slpjs";
import BigNumber from "bignumber.js";

export class GraphMap extends Map<string, GraphTxn> {
    public pruned = new Map<string, GraphTxn>();
    private _rootId: string;
    private _parentContainer: SlpTokenGraph;
    private _prunedSendCount = 0;
    private _graphSendCount = 0;
    private _prunedMintCount = 0;
    private _graphMintCount = 0;
    private _prunedMintQuantity = new BigNumber(0);

    constructor(graph: SlpTokenGraph) {
        super();
        this._rootId = graph._tokenIdHex;
        this._parentContainer = graph;
        this._graphSendCount = 0;
        this._graphMintCount = 0;
    }

    fromDbos(dag: GraphTxnDbo[], prunedSendCount: number, prunedMintCount: number, prunedMintQuantity: BigNumber) {
        dag.forEach((item, idx) => {
            let gt = GraphMap.mapGraphTxnFromDbo(item, this._parentContainer._tokenDetails.decimals, this._parentContainer._network);
            this.set(item.graphTxn.txid, gt);
        });

        this._prunedSendCount = prunedSendCount;
        this._prunedMintCount = prunedMintCount;
        this._prunedMintQuantity = prunedMintQuantity;
    }

    get SendCount() {
        return this._prunedSendCount + this._graphSendCount;
    }

    get MintCount() {
        return this._prunedMintCount + this._graphMintCount
    }

    get TotalTransactionCount() {
        return this.SendCount + this.MintCount;
    }

    public ComputeUtxosAndAddresses() {
        let txns = Array.from(this.values());
        let outputs = txns.flatMap(txn => txn.outputs);
        let utxos = outputs.filter(o => o.status === TokenUtxoStatus.UNSPENT);
        let flags: { [key:string]: boolean } = {};
        let addresses = utxos.filter(txo => {
            if (flags[txo.address]) {
                return false;
            }
            flags[txo.address] = true;
            return true;
        }).map(o => o.address);

        return {
            txns,
            outputs,
            utxos,
            addresses
        };
    }

    public ComputeStatistics() {
        let flattened = this.ComputeUtxosAndAddresses();
        let txns = flattened.txns;
        let mints = txns.filter(txn => txn.details.transactionType === SlpTransactionType.MINT);
        let mintQuantity = mints.map(txn => txn.outputs.find(o => o.vout === 1)!.slpAmount)
                                .reduce((p: BigNumber, c:BigNumber) => p.plus(c), this._prunedMintQuantity);
        let mintStatus = mints.flatMap(o => o.outputs).filter(o => o.status === BatonUtxoStatus.BATON_UNSPENT).length > 0 ?
                            TokenBatonStatus.ALIVE :
                            TokenBatonStatus.DEAD_ENDED;

        return {
            raw: flattened, 
            mintQuantity,
            utxoCount: flattened.utxos.length,
            addressCount: flattened.addresses.length, 
            sendCount: this.SendCount,
            mintCount: this.MintCount,
            mintStatus
        }
    }

    private incrementGraphCount(txnType: SlpTransactionType) {
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount++;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount++;
        }
    }

    public set(txid: string, graphTxn: GraphTxn) {
        if (!this.has(txid)) {
            this.incrementGraphCount(graphTxn.details.transactionType);
        }
        return super.set(txid, graphTxn);
    }

    private decrementGraphCount(txnType: SlpTransactionType) {
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount--;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount--;
        }
    }

    public delete(txid: string) {
        if (this.has(txid)) {
            let deleted = super.delete(txid);
            if (deleted) {
                let t = this.get(txid)?.details.transactionType!;
                this.decrementGraphCount(t);
            }
        }
        return false;
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
        if (this.has(txid) && txid !== this._rootId) {
            let gt = this.get(txid)!;
            if (!gt.prevPruneHeight || pruneHeight >= gt.prevPruneHeight) {
                this.pruned.set(txid, gt);
                console.log(`[INFO] Pruned ${txid} with prune height of ${pruneHeight} : ${this.delete(txid)}`);
                if (gt.details.transactionType === SlpTransactionType.SEND) {
                    this._prunedSendCount++;
                } else if (gt.details.transactionType === SlpTransactionType.MINT) {
                    this._prunedMintCount++;
                    this._prunedMintQuantity.plus(gt.outputs.find(o => o.vout === 1)!.slpAmount);
                }
                return true;
            } else if (pruneHeight < gt.prevPruneHeight) {
                console.log(`[INFO] Pruning deferred until ${gt.prevPruneHeight}`);
            }
        }
        return false;
    }

    private flushPrunedItems() {
        const txids = Array.from(this.pruned.keys());
        this.pruned.forEach((i, txid) => {
            RpcClient.transactionCache.delete(txid);
            delete this._parentContainer._slpValidator.cachedRawTransactions[txid];
            delete this._parentContainer._slpValidator.cachedValidations[txid];
        });

        this.pruned.clear();
        return txids;
    }

    public static toDbo(graph: GraphMap, recentBlocks: {hash: string, height: number}[]): [GraphTxnDbo[], TokenDBObject] {
        let tg = graph._parentContainer;
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);
        let itemsToUpdate: GraphTxnDbo[] = [];
        graph.forEach((g, txid) => {
            let pruneHeight = null;

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
                if (!g.prevPruneHeight || pruneHeight >= g.prevPruneHeight) {
                    g.isDirty = true;
                } else if (g.prevPruneHeight) {
                    pruneHeight = g.prevPruneHeight;
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

        
        // Do the pruning here
        itemsToUpdate.forEach(dbo => { if (dbo.graphTxn.pruneHeight) graph.prune(dbo.graphTxn.txid, dbo.graphTxn.pruneHeight)});
        // canBePruned means it can still be pruned later (caused by totally spent transactions which are unaged)
        let canBePruned = Array.from(graph.values())
                                .flatMap(i => i.outputs)
                                .filter(i => 
                                    [ TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT ].includes(i.status)
                                ).length < graph.size;
        tg._isGraphTotallyPruned = !canBePruned;
        graph.flushPrunedItems();
        let tokenDbo = GraphMap.tokenDetailstoDbo(graph);
        return [ itemsToUpdate, tokenDbo ];
    }

    public static tokenDetailstoDbo(graph: GraphMap): TokenDBObject {
        let tg = graph._parentContainer;
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);

        let result: TokenDBObject = {
            schema_version: Config.db.token_schema_version,
            isGraphPruned: tg._isGraphTotallyPruned,
            lastUpdatedBlock: tg._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            mintBatonUtxo: tg._mintBatonUtxo,
            tokenStats: GraphMap.mapTokenStatstoDbo(tg),
            pruningState: {
                sendCount: graph._prunedSendCount,
                mintCount: graph._prunedMintCount,
                mintQuantity: Decimal128.fromString(graph._prunedMintQuantity.toFixed())
            }
            //commitments: graph._commitments
        }
        if(tg._nftParentId) {
            result.nftParentId = tg._nftParentId;
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
        let stats = graph.GetTokenStats();
        return {
            block_created: stats.block_created,
            block_last_active_send: stats.block_last_active_send,
            block_last_active_mint: stats.block_last_active_mint,
            qty_valid_txns_since_genesis: stats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: stats.qty_valid_token_utxos,
            qty_valid_token_addresses: stats.qty_valid_token_addresses,
            qty_token_minted: Decimal128.fromString(stats.qty_token_minted.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
            qty_token_burned: Decimal128.fromString(stats.qty_token_burned.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
            qty_token_circulating_supply: Decimal128.fromString(stats.qty_token_circulating_supply.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
            qty_satoshis_locked_up: stats.qty_satoshis_locked_up,
            minting_baton_status: stats.minting_baton_status
        }
    }

    public static mapGraphTxnFromDbo(dbo: GraphTxnDbo, decimals: number, network: string): GraphTxn {
        dbo.graphTxn.outputs.map(o => {
            o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**decimals)
        });
        dbo.graphTxn.inputs.map(o => o.slpAmount = <any>new BigNumber(o.slpAmount.toString()).multipliedBy(10**decimals))
        let gt: GraphTxn = {
            isDirty: false,
            details: SlpTokenGraph.MapDbTokenDetailsFromDbo(dbo.graphTxn.details, decimals),
            outputs: dbo.graphTxn.outputs as any as GraphTxnOutput[],
            inputs: dbo.graphTxn.inputs as any as GraphTxnInput[],
            blockHash: dbo.graphTxn.blockHash, 
            prevPruneHeight: dbo.graphTxn.pruneHeight
        }
        return gt;
    };
}
