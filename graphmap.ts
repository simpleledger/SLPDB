import { SlpTokenGraph } from "./slptokengraph";
import { GraphTxnDbo, GraphTxnDetailsDbo, GraphTxnOutputDbo, TokenDBObject as TokenDbo, GraphTxnInput, GraphTxnOutput, GraphTxn, SlpTransactionDetailsDbo, TokenPruneStateDbo, TokenUtxoStatus } from "./interfaces";
import { Decimal128 } from "mongodb";
import { Config } from "./config";
import { RpcClient } from "./rpc";
import { SlpTransactionType, SlpTransactionDetails, SlpVersionType } from "slpjs";
import BigNumber from "bignumber.js";

import { slpUtxos } from './utxos';
const globalUtxoSet = slpUtxos();

export class GraphMap extends Map<string, GraphTxn> {
    private _pruned = new Map<string, GraphTxn>();
    private _dirtyItems = new Set<string>();
    private _doubleSpent = new Set<string>();
    private _lastPruneHeight = 0;
    private _rootId: string;
    private _container: SlpTokenGraph;
    private _prunedSendCount = 0;
    private _graphSendCount = 0;
    private _prunedMintCount = 0;
    private _graphMintCount = 0;
    private _prunedMintQuantity = new BigNumber(0);
    private _graphMintQuantity = new BigNumber(0);
    private _prunedInvalidBurnQuantity = new BigNumber(0);
    private _graphInvalidBurnQuantity = new BigNumber(0);
    private _prunedValidBurnQuantity = new BigNumber(0);
    private _graphValidBurnQuantity = new BigNumber(0);

    constructor(graph: SlpTokenGraph) {
        super();
        this._rootId = graph._tokenIdHex;
        this._container = graph;
    }

    get DirtyCount() {
        return this._dirtyItems.size;
    }

    get SendCount() {
        return this._prunedSendCount + this._graphSendCount;
    }

    get MintCount() {
        return this._prunedMintCount + this._graphMintCount;
    }

    get TotalSupplyMinted() {
        return this._prunedMintQuantity.plus(this._graphMintQuantity).plus(this._container._tokenDetails.genesisOrMintQuantity!);
    }

    get CirculatingSupply() {
        return this.TotalSupplyMinted.minus(this.TotalBurnAmount);
    }

    get TotalTransactionCount() {
        return this.SendCount + this.MintCount;
    }

    get TotalBurnAmount() {
        return this._prunedInvalidBurnQuantity
                .plus(this._graphInvalidBurnQuantity)
                .plus(this._prunedValidBurnQuantity)
                .plus(this._graphValidBurnQuantity);
    }

    private _incrementGraphCount(graphTxn: GraphTxn) {
        let txnType = graphTxn.details.transactionType;
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount++;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount++;
            this._graphMintQuantity.plus(graphTxn.details.genesisOrMintQuantity!);
        }
    }

    public setFromDb(txid: string, graphTxn: GraphTxn) {
        if (!this.has(txid)) {
            this._incrementGraphCount(graphTxn);
        }
        return super.set(txid, graphTxn);
    }

    public set(txid: string, graphTxn: GraphTxn) {
        this.SetDirty(txid);
        if (!this.has(txid)) {
            this._incrementGraphCount(graphTxn);
        }
        return super.set(txid, graphTxn);
    }

    public SetDirty(txid: string) {
        this._dirtyItems.add(txid);
    }

    private _decrementGraphCount(graphTxn: GraphTxn) {
        let txnType = graphTxn.details.transactionType;
        if (txnType === SlpTransactionType.SEND) {
            this._graphSendCount--;
        } else if (txnType === SlpTransactionType.MINT) {
            this._graphMintCount--;
            this._graphMintQuantity.minus(graphTxn.details.genesisOrMintQuantity!);
        }
    }

    public delete(txid: string) {
        if (this.has(txid)) {
            let graphTxn = this.get(txid);
            let deleted = super.delete(txid);
            if (deleted) {
                this._decrementGraphCount(graphTxn!);
                return true;
            }
        }
        return false;
    }

    public deleteDoubleSpend(txid: string) {
        this._doubleSpent.add(txid);
        return this.delete(txid);
    }

    public has(txid: string, includePrunedItems=false): boolean {
        if(includePrunedItems) {
            return super.has(txid) || this._pruned.has(txid);
        }
        return super.has(txid);
    }

    public get(txid: string, includePrunedItems=false): GraphTxn|undefined {
        if(includePrunedItems) {
            return super.get(txid) || this._pruned.get(txid);
        }
        return super.get(txid);
    }

    private prune(txid: string, pruneHeight: number) {
        this._lastPruneHeight = pruneHeight;
        if (this.has(txid) && txid !== this._rootId) {
            let gt = this.get(txid)!;
            if (!gt.prevPruneHeight || pruneHeight >= gt.prevPruneHeight) {
                this._pruned.set(txid, gt);
                this.delete(txid);
                console.log(`[INFO] Pruned ${txid} with prune height of ${pruneHeight}`);
                if (gt.details.transactionType === SlpTransactionType.SEND) {
                    this._prunedSendCount++;
                } else if (gt.details.transactionType === SlpTransactionType.MINT) {
                    this._prunedMintCount++;
                    this._prunedMintQuantity.plus(gt.outputs.find(o => o.vout === 1)!.slpAmount);
                }
                gt.outputs.filter(o => o.status === TokenUtxoStatus.SPENT_NON_SLP).forEach(o => {
                    this._graphInvalidBurnQuantity.minus(o.slpAmount);
                    this._prunedInvalidBurnQuantity.plus(o.slpAmount);
                });
                gt.outputs.filter(o => [ TokenUtxoStatus.EXCESS_INPUT_BURNED, 
                                            TokenUtxoStatus.MISSING_BCH_VOUT,
                                            TokenUtxoStatus.SPENT_NOT_IN_SEND,
                                            TokenUtxoStatus.SPENT_WRONG_TOKEN ]
                                    .includes(o.status as TokenUtxoStatus)).forEach(o => {
                    this._graphValidBurnQuantity.minus(o.slpAmount);
                    this._prunedValidBurnQuantity.plus(o.slpAmount);
                });
                return true;
            } else if (pruneHeight < gt.prevPruneHeight) {
                console.log(`[INFO] Pruning deferred until ${gt.prevPruneHeight}`);
            }
        }
        return false;
    }

    private _flush() {
        const txids = Array.from(this._pruned.keys());
        this._pruned.forEach((i, txid) => {
            RpcClient.transactionCache.delete(txid);
            delete this._container._slpValidator.cachedRawTransactions[txid];
            delete this._container._slpValidator.cachedValidations[txid];
        });
        this._doubleSpent.clear();
        this._pruned.clear();
        this._dirtyItems.clear();
        return txids;
    }

    public static toDbos(graph: GraphMap): { itemsToUpdate: GraphTxnDbo[], tokenDbo: TokenDbo, itemsToDelete: string[] } {
        let tg = graph._container;
        let itemsToUpdate: GraphTxnDbo[] = [];

        graph._dirtyItems.forEach(txid => {
            let g = graph.get(txid)!;
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
                    pruneHeight: g.prevPruneHeight
                }
            };
            itemsToUpdate.push(dbo);

            // increment invalid burn quantity
            g.outputs.filter(o => o.status === TokenUtxoStatus.SPENT_NON_SLP).forEach(o => {
                graph._graphInvalidBurnQuantity.plus(o.slpAmount);
            });

            // increment valid burn quanity
            g.outputs.filter(o => [ TokenUtxoStatus.EXCESS_INPUT_BURNED, 
                                    TokenUtxoStatus.MISSING_BCH_VOUT,
                                    TokenUtxoStatus.SPENT_NOT_IN_SEND,
                                    TokenUtxoStatus.SPENT_WRONG_TOKEN]
                                    .includes(o.status as TokenUtxoStatus)).forEach(o => {
                graph._graphValidBurnQuantity.plus(o.slpAmount);
            });
        });

        let itemsToDelete = Array.from(graph._doubleSpent);
        
        // Do the pruning here
        itemsToUpdate.forEach(dbo => { if (dbo.graphTxn.pruneHeight) graph.prune(dbo.graphTxn.txid, dbo.graphTxn.pruneHeight)});
        graph._flush();
        let tokenDbo = GraphMap._mapTokenToDbo(graph);
        return { itemsToUpdate, tokenDbo, itemsToDelete };
    }

    public fromDbos(dag: GraphTxnDbo[], pruneState: TokenPruneStateDbo) {
        dag.forEach((item, idx) => {
            let gt = GraphMap.mapGraphTxnFromDbo(item, this._container._tokenDetails.decimals);
            gt.outputs.forEach(o => {
                globalUtxoSet.set(`${item.graphTxn.txid}:${o.vout}`, Buffer.from(this._rootId, "hex"));
                if (o.status === TokenUtxoStatus.SPENT_NON_SLP) {
                    this._graphInvalidBurnQuantity.plus(o.slpAmount);
                }
                if ([ TokenUtxoStatus.EXCESS_INPUT_BURNED,
                      TokenUtxoStatus.MISSING_BCH_VOUT,
                      TokenUtxoStatus.SPENT_NOT_IN_SEND,
                      TokenUtxoStatus.SPENT_WRONG_TOKEN ].includes(o.status as TokenUtxoStatus)) {
                    this._graphValidBurnQuantity.plus(o.slpAmount);
                }
            });
            this.setFromDb(item.graphTxn.txid, gt);
        });
        this._lastPruneHeight = pruneState.pruneHeight;
        this._prunedSendCount = pruneState.sendCount;
        this._prunedMintCount = pruneState.mintCount;
        this._prunedMintQuantity = new BigNumber(pruneState.mintQuantity.toString());
        this._prunedInvalidBurnQuantity = new BigNumber(pruneState.invalidBurnQuantity.toString());
        this._prunedValidBurnQuantity = new BigNumber(pruneState.invalidBurnQuantity.toString());
    }

    private static _mapTokenToDbo(graph: GraphMap): TokenDbo {
        let tg = graph._container;
        let tokenDetails = GraphMap._mapTokenDetailsToDbo(tg._tokenDetails, tg._tokenDetails.decimals);

        let mint = graph.TotalSupplyMinted.dividedBy(10**tg._tokenDetails.decimals);
        let burn = graph.TotalBurnAmount.dividedBy(10**tg._tokenDetails.decimals);
        let circ = mint.minus(burn);

        let result: TokenDbo = {
            schema_version: Config.db.token_schema_version,
            lastUpdatedBlock: tg._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            mintBatonUtxo: tg._mintBatonUtxo,
            mintBatonStatus: tg._mintBatonStatus,
            tokenStats: {
                block_created: tg._blockCreated,
                qty_valid_txns_since_genesis: graph.SendCount,
                qty_token_minted: Decimal128.fromString(mint.toFixed()),
                qty_token_burned: Decimal128.fromString(burn.toFixed()),
                qty_token_circulating_supply: Decimal128.fromString(circ.toFixed()),
                qty_satoshis_locked_up: null,
            },
            pruningState: {
                pruneHeight: graph._lastPruneHeight,
                sendCount: graph._prunedSendCount,
                mintCount: graph._prunedMintCount,
                mintQuantity: Decimal128.fromString(graph._prunedMintQuantity.toFixed()),
                invalidBurnQuantity: Decimal128.fromString(graph._prunedInvalidBurnQuantity.toFixed()),
                validBurnQuantity: Decimal128.fromString(graph._prunedValidBurnQuantity.toFixed())
            }
        }
        if (tg._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
            if (!tg._nftParentId) {
                throw Error("Missing NFT1 parent token Id.");
            }
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
