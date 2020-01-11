import { SlpTokenGraph } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo, TokenUtxoStatus, BatonUtxoStatus, TokenDBObject as TokenDbo, TokenStatsDbo, TokenBatonStatus, GraphTxnInput, GraphTxnOutput, GraphTxn, SlpTransactionDetailsDbo } from "./interfaces";
import { Decimal128 } from "mongodb";
import { Config } from "./config";
import { RpcClient } from "./rpc";
import { SlpTransactionType, SlpTransactionDetails } from "slpjs";
import BigNumber from "bignumber.js";

export class GraphMap extends Map<string, GraphTxn> {
    public pruned = new Map<string, GraphTxn>();
    public doubleSpent = new Set<string>();
    private _rootId: string;
    private _container: SlpTokenGraph;
    private _prunedSendCount = 0;
    private _graphSendCount = 0;
    private _prunedMintCount = 0;
    private _graphMintCount = 0;
    private _prunedMintQuantity = new BigNumber(0);

    constructor(graph: SlpTokenGraph) {
        super();
        this._rootId = graph._tokenIdHex;
        this._container = graph;
        this._graphSendCount = 0;
        this._graphMintCount = 0;
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

    public ComputeStatistics(): GraphStats {
        let flattened = this.ComputeUtxosAndAddresses();
        let txns = flattened.txns;
        let mints = txns.filter(txn => txn.details.transactionType === SlpTransactionType.MINT);
        let mintQuantity = mints.map(txn => txn.outputs
                                .find(o => o.vout === 1)!.slpAmount)
                                .reduce((p: BigNumber, c:BigNumber) => p.plus(c), this._prunedMintQuantity);
        let mintStatus = mints.flatMap(o => o.outputs)
                              .filter(o => o.status === BatonUtxoStatus.BATON_UNSPENT)
                              .length > 0 ? TokenBatonStatus.ALIVE : TokenBatonStatus.DEAD_ENDED;
        let canBePruned = flattened.outputs
                                        .filter(o => [ 
                                            TokenUtxoStatus.UNSPENT, 
                                            BatonUtxoStatus.BATON_UNSPENT 
                                        ].includes(o.status)).length < this.size;
        return {
            raw: flattened, 
            mintQuantity,
            utxoCount: flattened.utxos.length,
            addressCount: flattened.addresses.length, 
            sendCount: this.SendCount,
            mintCount: this.MintCount,
            mintStatus,
            canBePruned
        }
    }

    private _incrementGraphCount(txnType: SlpTransactionType) {
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount++;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount++;
        }
    }

    public set(txid: string, graphTxn: GraphTxn) {
        if (!this.has(txid)) {
            this._incrementGraphCount(graphTxn.details.transactionType);
        }
        return super.set(txid, graphTxn);
    }

    private _decrementGraphCount(txnType: SlpTransactionType) {
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
                this._decrementGraphCount(t);
            }
        }
        return false;
    }

    public deleteDoubleSpend(txid: string) {
        this.doubleSpent.add(txid);
        return this.delete(txid);
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

    private _flush() {
        const txids = Array.from(this.pruned.keys());
        this.pruned.forEach((i, txid) => {
            RpcClient.transactionCache.delete(txid);
            delete this._container._slpValidator.cachedRawTransactions[txid];
            delete this._container._slpValidator.cachedValidations[txid];
        });
        this.doubleSpent.clear();
        this.pruned.clear();
        return txids;
    }

    public static toDbos(graph: GraphMap, recentBlocks?: {hash: string, height: number}[]): { itemsToUpdate: GraphTxnDbo[], tokenDbo: TokenDbo, itemsToDelete: string[] } {
        let tg = graph._container;
        let itemsToUpdate: GraphTxnDbo[] = [];
        graph.forEach((g, txid) => {
            let pruneHeight = null;

            // Here we determine if a graph object should be marked as aged and spent,
            // this will prevent future loading of the object.  
            // We also unload the object from memory if pruning is true.
            const BLOCK_AGE_CUTOFF = 10;
            let isAgedAndSpent =
                g.blockHash &&
                recentBlocks && recentBlocks.length > BLOCK_AGE_CUTOFF-1 &&
                !recentBlocks.map(i => i.hash).includes(g.blockHash.toString("hex")) &&
                !(g.outputs.filter(i => [ TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT ].includes(i.status)).length > 0);

            if (isAgedAndSpent) {
                pruneHeight = recentBlocks![BLOCK_AGE_CUTOFF-1].height;
                if (!g.prevPruneHeight || pruneHeight >= g.prevPruneHeight) {
                    g.isDirty = true;
                } else if (g.prevPruneHeight) {
                    pruneHeight = g.prevPruneHeight;
                }
            }

            if (g.isDirty) {
                let dbo: GraphTxnDbo = {
                    tokenDetails: { tokenIdHex: graph._container._tokenIdHex },
                    graphTxn: {
                        txid,
                        details: GraphMap._mapTokenDetailsToDbo(g.details, tg._tokenDetails.decimals),
                        outputs: GraphMap._txnOutputsToDbo(tg, g.outputs),
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

        let itemsToDelete = Array.from(graph.doubleSpent);
        
        // Do the pruning here
        itemsToUpdate.forEach(dbo => { if (dbo.graphTxn.pruneHeight) graph.prune(dbo.graphTxn.txid, dbo.graphTxn.pruneHeight)});
        // canBePruned means it can still be pruned later (caused by totally spent transactions which are unaged)
        graph._flush();
        let tokenDbo = GraphMap._mapTokenToDbo(graph);
        return { itemsToUpdate, tokenDbo, itemsToDelete };
    }

    public fromDbos(dag: GraphTxnDbo[], prunedSendCount: number, prunedMintCount: number, prunedMintQuantity: BigNumber) {
        dag.forEach((item, idx) => {
            let gt = GraphMap.mapGraphTxnFromDbo(item, this._container._tokenDetails.decimals);
            this.set(item.graphTxn.txid, gt);
        });

        this._prunedSendCount = prunedSendCount;
        this._prunedMintCount = prunedMintCount;
        this._prunedMintQuantity = prunedMintQuantity;
    }

    private static _mapTokenToDbo(graph: GraphMap): TokenDbo {
        let tg = graph._container;
        let tokenDetails = GraphMap._mapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);

        let stats = graph.ComputeStatistics();

        let result: TokenDbo = {
            schema_version: Config.db.token_schema_version,
            lastUpdatedBlock: tg._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            mintBatonUtxo: tg._mintBatonUtxo,
            tokenStats: {
                block_created: 0,                   //tg.block_created,
                block_last_active_send: 0,          //tg.block_last_active_send,
                block_last_active_mint: 0,          //tg.block_last_active_mint,
                qty_valid_txns_since_genesis: stats.sendCount,
                qty_valid_token_utxos: stats.utxoCount,
                qty_valid_token_addresses: stats.addressCount,
                qty_token_minted: Decimal128.fromString(stats.mintQuantity.dividedBy(10**tg._tokenDetails.decimals).toFixed()),
                qty_token_burned: Decimal128.fromString("0"),               //stats.qty_token_burned.dividedBy(10**graph._tokenDetails.decimals).toFixed()),
                qty_token_circulating_supply: Decimal128.fromString("0"),   //stats..dividedBy(10**tg._tokenDetails.decimals).toFixed()),
                qty_satoshis_locked_up: 0,                                  //stats.qty_satoshis_locked_up,
                minting_baton_status: stats.mintStatus
            },
            pruningState: {
                sendCount: graph._prunedSendCount,
                mintCount: graph._prunedMintCount,
                mintQuantity: Decimal128.fromString(graph._prunedMintQuantity.toFixed()),
                canBePruned: stats.canBePruned
            }
        }
        if (tg._nftParentId) {
            result.nftParentId = tg._nftParentId;
        }
        return result;
    }

    private static _txnOutputsToDbo(tokenGraph: SlpTokenGraph, outputs: GraphTxnOutput[]): GraphTxnOutputDbo[] {
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

    public static mapGraphTxnFromDbo(dbo: GraphTxnDbo, decimals: number): GraphTxn {
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
    }

    private static _mapTokenDetailsToDbo(details: SlpTransactionDetails, decimals: number): SlpTransactionDetailsDbo {
        let res: SlpTransactionDetailsDbo = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp ? details.timestamp : null,
            timestamp_unix: details.timestamp ? this.ConvertToUnixTime(details.timestamp) : null,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256Hex: details.documentSha256 ? details.documentSha256.toString('hex') : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton ? true : false,
            genesisOrMintQuantity: details.genesisOrMintQuantity ? Decimal128.fromString(details.genesisOrMintQuantity!.dividedBy(10**decimals).toFixed()) : null,
            sendOutputs: details.sendOutputs ? details.sendOutputs.map(o => Decimal128.fromString(o.dividedBy(10**decimals).toFixed())) : null
        }

        return res;
    }

    private static ConvertToUnixTime(Y_m_d_H_M_S: string): number|null {
        // timestamp is formatted as "%Y-%m-%d %H:%M:%S"
        if(Y_m_d_H_M_S) {
            let d = Y_m_d_H_M_S.split(" ")[0] + "T" + Y_m_d_H_M_S.split(" ")[1] + "Z";
            return Date.parse(d)/1000;
        }
        return null;
    }
}

interface GraphStats {
    raw: any; 
    mintQuantity: BigNumber;
    utxoCount: number;
    addressCount: number;
    sendCount: number;
    mintCount: number;
    mintStatus: TokenBatonStatus;
    canBePruned: boolean;
}