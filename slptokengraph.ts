import { SlpTransactionDetails, SlpTransactionType, LocalValidator, 
         Utils, Slp, Primatives, SlpVersionType } from 'slpjs';
import BigNumber from 'bignumber.js';
import { BITBOX } from 'bitbox-sdk';
import * as bitcore from 'bitcore-lib-cash';
import { SendTxnQueryResult, Query } from './query';
import { Db } from './db';
import { RpcClient } from './rpc';
import * as pQueue from 'p-queue';
import { DefaultAddOptions } from 'p-queue';
import { SlpGraphManager } from './slpgraphmanager';
import { CacheMap } from './cache';
import { SlpTransactionDetailsDbo, TokenUtxoStatus,
         BatonUtxoStatus, TokenBatonStatus, GraphTxn, TokenDBObject } from './interfaces';
import { GraphMap } from './graphmap';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const bitbox = new BITBOX();
const slp = new Slp(bitbox);

import { slpUtxos } from './utxos';
const globalUtxoSet = slpUtxos();

import { PruneStack } from './prunestack';

export class SlpTokenGraph {

    _tokenIdHex: string;
    _tokenIdBuf: Buffer; // NOTE: will need to consider future interaction with lazy loading/garbage collection 
    _lastUpdatedBlock!: number;
    _tokenDetails: SlpTransactionDetails;
    _blockCreated: number|null;
    _mintBatonUtxo = "";
    _mintBatonStatus = TokenBatonStatus.UNKNOWN;
    _nftParentId?: string;
    _graphTxns: GraphMap;
    _slpValidator = new LocalValidator(bitbox, async (txids) => {
        // if (this._manager._bit.doubleSpendCache.has(txids[0])) {
        //     return [ Buffer.alloc(60).toString('hex') ];
        // }
        let txn;
        try {
            txn = <string>await RpcClient.getRawTransaction(txids[0], false);
        } catch(err) {
            console.log(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`);
            return [ Buffer.alloc(60).toString('hex') ];
        }
        return [ txn ];
    }, console);
    _network: string;
    _db: Db;
    _graphUpdateQueue: pQueue<DefaultAddOptions> = new pQueue({ concurrency: 1, autoStart: true });
    _graphUpdateQueueOnIdle?: ((self: this) => Promise<void>) | null;
    _graphUpdateQueueNewTxids = new Set<string>();
    _manager: SlpGraphManager;
    _startupTxoSendCache?: CacheMap<string, SpentTxos>;
    _loadInitiated = false;
    _lazilyLoaded = false;
    _updateComplete = true;
    _isValid?: boolean;
    _tokenDbo: TokenDBObject|null;

    constructor(tokenDetails: SlpTransactionDetails, manager: SlpGraphManager, blockCreated: number|null, tokenDbo: TokenDBObject|null) {
        this._tokenDetails = tokenDetails;
        this._tokenIdHex = tokenDetails.tokenIdHex;
        this._tokenIdBuf = Buffer.from(this._tokenIdHex, "hex");
        this._graphTxns = new GraphMap(this);
        this._db = manager.db;
        this._manager = manager;
        this._network = manager._network;
        this._blockCreated =  blockCreated;
        this._tokenDbo = tokenDbo;
    }

    get graphSize() {
        return this._graphTxns.size;
    }

    public scanDoubleSpendTxids(txidToDelete: Set<string>): boolean {
        for (let txid of txidToDelete) {
            if (this._graphTxns.has(txid)) {
                RpcClient.transactionCache.delete(txid);
                this._graphTxns.delete(txid);
                this.commitToDb();
                return true;
            }
        }
        return false
    }

    markInvalidSlpOutputAsBurned(txo: string, burnedInTxid: string, blockIndex: number) {
        let txid = txo.split(":")[0];
        let vout = Number.parseInt(txo.split(":")[1]);
        let gt = this._graphTxns.get(txid);
        if (gt) {
            let o = gt.outputs.find(o => o.vout === vout && [TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT].includes(o.status));
            if (o) {
                let batonVout;
                if ([SlpTransactionType.GENESIS, SlpTransactionType.MINT].includes(gt.details.transactionType)) {
                    batonVout = gt.details.batonVout;
                }
                if (batonVout === vout) {
                    o.status = BatonUtxoStatus.BATON_SPENT_INVALID_SLP;
                    o.invalidReason = "Token baton output burned in an invalid SLP transaction";
                    this._mintBatonUtxo = "";
                    this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;
                } else {
                    o.status = TokenUtxoStatus.SPENT_INVALID_SLP;
                    o.invalidReason = "Output burned in an invalid SLP transaction";
                }
                o.spendTxid = burnedInTxid;
                this._graphTxns.setDirty(txid);
                if (gt.outputs.filter(o => [ TokenUtxoStatus.UNSPENT, BatonUtxoStatus.BATON_UNSPENT ].includes(o.status)).length === 0) {
                    let pruningStack = PruneStack()
                    pruningStack.addGraphTxidToPruningStack(blockIndex, this._tokenIdHex, txid);
                }
                return true;
            }
        }
        return false;
    }

    public considerTxidsForPruning(txids: string[], pruneHeight: number) {
        for (let txid of txids) {
            let gt = this._graphTxns.get(txid);
            if (gt) {
                let canBePruned = gt.outputs.filter(o => [ 
                                        BatonUtxoStatus.BATON_UNSPENT, 
                                        TokenUtxoStatus.UNSPENT
                                    ].includes(o.status)).length === 0;
                if (canBePruned) {
                    if (!gt.prevPruneHeight || pruneHeight >= gt.prevPruneHeight) {
                        gt.prevPruneHeight = pruneHeight;
                        this._graphTxns.setDirty(txid);
                    }
                }
            }
        }
    }

    public async commitToDb() {
        await this._db.graphItemsUpsert(this._graphTxns);
        this._updateComplete = true;
    }

    public async validateTxid(txid: string) {
        await this._slpValidator.isValidSlpTxid(txid, this._tokenIdHex);
        const validation = this._slpValidator.cachedValidations[txid];
        if (! validation.validity) {
            delete this._slpValidator.cachedValidations[txid];
            delete this._slpValidator.cachedRawTransactions[txid];
        }
        return validation;
    }

    public async stop() {
        console.log(`[INFO] Stopping token graph ${this._tokenIdHex}, with ${this._graphTxns.size} loaded.`);

        if (this._graphUpdateQueue.pending || this._graphUpdateQueue.size) {
            console.log(`[INFO] Waiting on ${this._graphUpdateQueue.size} queue items.`);
            if (!this._graphUpdateQueue.isPaused) {
                await this._graphUpdateQueue.onIdle();
                this._graphUpdateQueue.pause();
                console.log(`[INFO] Graph update queue is idle and cleared with ${this._graphUpdateQueue.size} items and ${this._graphUpdateQueue.pending} pending.`);
            }
        }

        let dirtyCount = this._graphTxns.DirtyCount;
        console.log(`[INFO] On stop there are ${dirtyCount} dirty items.`);
        if (dirtyCount > 0) {
            this.commitToDb();
        }

        while (this._graphUpdateQueueOnIdle !== undefined || !this._updateComplete) {
            console.log(`Waiting for UpdateStatistics to finish for ${this._tokenIdHex}`);
            await sleep(500);
        }
        console.log(`[INFO] Stopped token graph ${this._tokenIdHex}`);
    }

    public async setNftParentId() {
        if (this._tokenDetails.versionType === SlpVersionType.TokenVersionType1_NFT_Child) {
            let txnhex = await RpcClient.getRawTransaction(this._tokenIdHex);
            let tx = Primatives.Transaction.parseFromBuffer(Buffer.from(txnhex, 'hex'));
            let nftBurnTxnHex = await RpcClient.getRawTransaction(tx.inputs[0].previousTxHash);
            let nftBurnTxn = Primatives.Transaction.parseFromBuffer(Buffer.from(nftBurnTxnHex, 'hex'));
            let nftBurnSlp = slp.parseSlpOutputScript(Buffer.from(nftBurnTxn.outputs[0].scriptPubKey));

            if (nftBurnSlp.transactionType === SlpTransactionType.GENESIS) {
                this._nftParentId = tx.inputs[0].previousTxHash;
            } else {
                this._nftParentId = nftBurnSlp.tokenIdHex;
            }
        }
    }

    public async IsValid(): Promise<boolean> {
        if (this._isValid || this._isValid === false) {
            return this._isValid;
        }
        this._isValid = await this._slpValidator.isValidSlpTxid(this._tokenIdHex);
        return this._isValid;
    }

    public get IsLoaded(): boolean {
        return this._graphTxns.size > 0;
    }

    private async getMintBatonSpentOutputDetails({ txid, vout }: { txid: string; vout: number; }): Promise<MintSpendDetails> {
        let spendTxnInfo: SendTxnQueryResult | {txid: string, block: number|null} | undefined
        if (this._startupTxoSendCache) {
            spendTxnInfo = this._startupTxoSendCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used _startupTxoSendCache data", txid, vout);
            }
        }
        if (!spendTxnInfo) {
            spendTxnInfo = this._manager._bit._spentTxoCache.get(txid + ":" + vout); //this._liveTxoSpendCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used bit._spentTxoCache data", txid, vout);
            }
        }
        // This is a backup to prevent bad data, it should rarely be used and should be removed in the future
        if (!spendTxnInfo) {
            let res = await Query.queryForTxoInputAsSlpMint(txid, vout);
            if (res) {
                spendTxnInfo = { txid: res.txid!, block: res.block };
            }
        }
        if (!spendTxnInfo) {
            throw Error(`Unable to locate spend details for output ${txid}:${vout}.`);
        }
        let validation = await this.validateTxid(spendTxnInfo.txid!);
        if (!validation) {
            throw Error(`SLP Validator is missing transaction ${spendTxnInfo.txid} for token ${this._tokenDetails.tokenIdHex}`);
        }
        if (validation.validity && validation.details!.transactionType === SlpTransactionType.MINT) {
            globalUtxoSet.delete(`${txid}:${vout}`);
            return { status: BatonUtxoStatus.BATON_SPENT_IN_MINT, txid: spendTxnInfo!.txid, invalidReason: null };
        } else if (validation.validity) {
            this._mintBatonUtxo = '';
            this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;
            globalUtxoSet.delete(`${txid}:${vout}`);
            return { status: BatonUtxoStatus.BATON_SPENT_NOT_IN_MINT, txid: spendTxnInfo!.txid, invalidReason: "Baton was spent in a non-mint SLP transaction." };
        } else {
            this._mintBatonUtxo = '';
            this._mintBatonStatus = TokenBatonStatus.DEAD_BURNED;

            const txnHex = await RpcClient.getRawTransaction(spendTxnInfo.txid!);
            const txn = Primatives.Transaction.parseFromBuffer(Buffer.from(txnHex, "hex"));

            // SPENT_INVALID_SLP (bad OP_RETURN)          
            try {
                slp.parseSlpOutputScript(Buffer.from(txn.outputs[0]!.scriptPubKey));
            } catch (_) {
                return  { status: BatonUtxoStatus.BATON_SPENT_INVALID_SLP, txid: spendTxnInfo.txid!, invalidReason: "SLP baton output was spent in an invalid SLP transaction (bad SLP metadata)." }
            }

            // SPENT_INVALID_SLP (bad DAG)          
            if (! validation.validity) {
                return  { status: BatonUtxoStatus.BATON_SPENT_INVALID_SLP, txid: spendTxnInfo.txid!, invalidReason: "SLP baton output was spent in an invalid SLP transaction (bad DAG)." }
            }

            // MISSING_BCH_VOUT
            if (vout > txn.outputs.length-1) {
                return { status: BatonUtxoStatus.BATON_MISSING_BCH_VOUT, txid: spendTxnInfo.txid!, invalidReason: "SLP baton output has no corresponding BCH output." };
            }

            throw Error(`Unhandled scenario for updating token baton output status (${txid}:${vout} in ${spendTxnInfo.txid})`);
        }
    }

    private async getSpentOutputDetails({ txid, vout }: { txid: string; vout: number; }): Promise<SpendDetails> {
        let spendTxnInfo: SendTxnQueryResult | { txid: string, block: number|null } | undefined
        if (this._startupTxoSendCache) {
            spendTxnInfo = this._startupTxoSendCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used _startupTxoSendCache data", txid, vout);
            }
        }
        if (!spendTxnInfo) {
            spendTxnInfo = this._manager._bit._spentTxoCache.get(txid + ":" + vout);
            if (spendTxnInfo) {
                console.log("[INFO] Used bit._spentTxoCache spend data", txid, vout);
            }
        }
        // NOTE: This is a backup to prevent bad data, it should rarely be used and should be removed in the future
        if (!spendTxnInfo) {
            let res = await Query.queryForTxoInputAsSlpSend(txid, vout);
            if (res) {
                console.log(`[DEBUG] OUTPUT INFO ADDED: ${txid}:${vout} -> ${res.txid}`);
                spendTxnInfo = { txid: res.txid!, block: res.block };
            }
        }
        if (!spendTxnInfo) {
            throw Error(`Unable to locate spend details for output ${txid}:${vout}.`);
        }
        let validation = await this.validateTxid(spendTxnInfo.txid!);
        if (!validation) {
            throw Error(`SLP Validator is missing transaction ${spendTxnInfo.txid} for token ${this._tokenDetails.tokenIdHex}`);
        }
        if (validation.validity && validation.details!.transactionType === SlpTransactionType.SEND) {
            globalUtxoSet.delete(`${txid}:${vout}`);
            return { status: TokenUtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, invalidReason: null };
        } else if (validation.validity) {
            globalUtxoSet.delete(`${txid}:${vout}`);
            return { status: TokenUtxoStatus.SPENT_NOT_IN_SEND, txid: spendTxnInfo!.txid, invalidReason: null };
        } else {
            const txnHex = await RpcClient.getRawTransaction(spendTxnInfo.txid!);
            const txn = Primatives.Transaction.parseFromBuffer(Buffer.from(txnHex, "hex"));

            // SPENT_INVALID_SLP (bad OP_RETURN)
            try {
                slp.parseSlpOutputScript(Buffer.from(txn.outputs[0]!.scriptPubKey));
            } catch (_) {
                return  { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: spendTxnInfo.txid!, invalidReason: "SLP output was spent in an invalid SLP transaction (bad SLP metadata)." }
            }

            // SPENT_INVALID_SLP (bad DAG)
            if (! validation.validity) {
                return  { status: TokenUtxoStatus.SPENT_INVALID_SLP, txid: spendTxnInfo.txid!, invalidReason: "SLP output was spent in an invalid SLP transaction (bad DAG)." }
            }

            // MISSING_BCH_VOUT
            if (vout > txn.outputs.length-1) {
                return { status: TokenUtxoStatus.MISSING_BCH_VOUT, txid: spendTxnInfo.txid!, invalidReason: "SLP output has no corresponding BCH output." };
            }

            throw Error(`Unhandled scenario for updating token output status (${txid}${vout} in ${spendTxnInfo.txid})`);
        }
    }

    public async queueAddGraphTransaction({ txid }: { txid: string }): Promise<void> {
        let self = this;

        while (this._loadInitiated && !this.IsLoaded && this._tokenIdHex !== txid) {
            console.log(`Waiting for token ${this._tokenIdHex} to finish loading...`);
            await sleep(250);
        }

        if (!this._loadInitiated && !this.IsLoaded) {
            this._loadInitiated = true;
            return this._graphUpdateQueue.add(async () => {
                console.log(`[INFO] (queueTokenGraphUpdateFrom) Initiating graph for ${txid}`);
                await self.addGraphTransaction({ txid });
            });
        } else {
            return this._graphUpdateQueue.add(async () => {
                console.log(`[INFO] (queueTokenGraphUpdateFrom) Updating graph from ${txid}`);
                await self.addGraphTransaction({ txid });
            });
        }
    }

    public async addGraphTransaction({ txid, processUpToBlock, blockHash }: { txid: string; processUpToBlock?: number; blockHash?: Buffer; }): Promise<boolean|null> {
        if (this._graphTxns.has(txid)) {
            let gt = this._graphTxns.get(txid)!;
            if (blockHash) {
                gt.blockHash = blockHash;
                this._graphTxns.setDirty(txid);
            }
            return true;
        }

        let isValid = await this._slpValidator.isValidSlpTxid(txid, this._tokenDetails.tokenIdHex);
        let txnSlpDetails = this._slpValidator.cachedValidations[txid].details;
        let txn: bitcore.Transaction = new bitcore.Transaction(await this._slpValidator.retrieveRawTransaction(txid));

        if (!txnSlpDetails) {
            console.log("[WARN] addGraphTransaction: No token details for:", txid);
            return false;
        }

        let graphTxn: GraphTxn = {
            details: txnSlpDetails,
            outputs: [],
            inputs: [],
            blockHash: blockHash ? blockHash : null,
            prevPruneHeight: null
        };

        console.log(`[INFO] Unpruned txn count: ${this._graphTxns.size} (token: ${this._tokenIdHex})`);

        // Update parent items (their output statuses) and add contributing SLP inputs
        if (txid !== this._tokenIdHex) {
            let visited = new Set<string>();

            // update parent input details
            for (let i of txn.inputs) {
                let previd = i.prevTxId.toString('hex');

                if (this._graphTxns.has(previd)) {
                    let ptxn = this._graphTxns.get(previd)!;
                    this._graphTxns.setDirty(previd);
                    // update the parent's output items
                    console.log("[INFO] addGraphTransaction: update the status of the input txns' outputs");
                    if (!visited.has(previd)) {
                        visited.add(previd);
                        //await this.updateTokenGraphAt({ txid: previd, isParentInfo: {  }, processUpToBlock });
                        let gtos = ptxn!.outputs;
                        let prevOutpoints = txn.inputs.filter(i => i.prevTxId.toString('hex') === previd).map(i => i.outputIndex);
                        for (let vout of prevOutpoints) {
                            let spendInfo: SpendDetails|MintSpendDetails;
                            if ([SlpTransactionType.GENESIS, SlpTransactionType.MINT].includes(ptxn!.details.transactionType) &&
                                ptxn.details.batonVout === vout) {
                                    spendInfo = await this.getMintBatonSpentOutputDetails({ txid: previd, vout });
                            } else {
                                spendInfo = await this.getSpentOutputDetails({ txid: previd, vout });
                            }
                            let o = gtos.find(o => o.vout === vout);
                            if (o) {
                                o.spendTxid = txid;
                                o.status = spendInfo.status;
                                o.invalidReason = spendInfo.invalidReason;
                            }
                        }
                        if (processUpToBlock && gtos.filter(o => [ TokenUtxoStatus.UNSPENT, 
                                                                    BatonUtxoStatus.BATON_UNSPENT ].includes(o.status)).length === 0) 
                        {
                            let pruningStack = PruneStack();
                            pruningStack.addGraphTxidToPruningStack(processUpToBlock, this._tokenIdHex, previd);
                        }
                    }

                    // add the current input item to the current graphTxn object
                    let inputTxn = this._graphTxns.get(previd)!;
                    let o = inputTxn.outputs.find(o => o.vout === i.outputIndex);
                    if (o) {
                        graphTxn.inputs.push({
                            txid: i.prevTxId.toString('hex'),
                            vout: i.outputIndex,
                            slpAmount: o.slpAmount,
                            address: o.address!,
                            bchSatoshis: o.bchSatoshis!
                        });
                        this._graphTxns.setDirty(previd);
                    }
                }
            }

            if (graphTxn.inputs.length === 0) {
                console.log(`[WARN] Cannot have a SEND or MINT transaction without any input (${txid}).`);
                //throw Error("Cannot have a SEND or MINT transaction without any input.");
            }
        }

        if (!isValid) {
            console.log("[WARN] addGraphTransaction: Not valid token transaction:", txid);
            this.mempoolCommitToDb({});
            return false;
        }

        // Create or update SLP graph outputs for each valid SLP output
        if (graphTxn.details.transactionType === SlpTransactionType.GENESIS || graphTxn.details.transactionType === SlpTransactionType.MINT) {
            if (graphTxn.details.genesisOrMintQuantity!.isGreaterThanOrEqualTo(0)) {
                let address = this.getAddressStringFromTxnOutput(txn, 1);
                globalUtxoSet.set(`${txid}:${1}`, this._tokenIdBuf.slice());
                graphTxn.outputs.push({
                    address: address,
                    vout: 1,
                    bchSatoshis: txn.outputs.length > 1 ? txn.outputs[1].satoshis : address ? 0 : null, 
                    slpAmount: graphTxn.details.genesisOrMintQuantity! as BigNumber,
                    spendTxid: null,
                    status: address ? TokenUtxoStatus.UNSPENT : TokenUtxoStatus.MISSING_BCH_VOUT,
                    invalidReason: address ? null : "Transaction is missing output."
                });
                if (txnSlpDetails.batonVout) {
                    this._mintBatonStatus = TokenBatonStatus.ALIVE;
                    this._mintBatonUtxo = `${txid}:${txnSlpDetails.batonVout}`;
                    let address = this.getAddressStringFromTxnOutput(txn, txnSlpDetails.batonVout);
                    globalUtxoSet.set(`${txid}:${txnSlpDetails.batonVout}`, this._tokenIdBuf.slice());
                    graphTxn.outputs.push({
                        address: address,
                        vout: txnSlpDetails.batonVout,
                        bchSatoshis: txnSlpDetails.batonVout < txn.outputs.length ? txn.outputs[txnSlpDetails.batonVout].satoshis : address ? 0 : null, 
                        slpAmount: new BigNumber(0),
                        spendTxid: null,
                        status: address ? BatonUtxoStatus.BATON_UNSPENT : BatonUtxoStatus.BATON_MISSING_BCH_VOUT,
                        invalidReason: address ? null : "Transaction is missing output."
                    });
                } else if (txnSlpDetails.batonVout === null) {
                    this._mintBatonUtxo = "";
                    this._mintBatonStatus = TokenBatonStatus.DEAD_ENDED;
                }
            }
        }
        else if(graphTxn.details.sendOutputs!.length > 0) {
            let slp_vout = 0;
            for (let output of graphTxn.details.sendOutputs!) {
                if (output.isGreaterThanOrEqualTo(0)) {
                    if (slp_vout > 0) {
                        let address = this.getAddressStringFromTxnOutput(txn, slp_vout);
                        globalUtxoSet.set(`${txid}:${slp_vout}`, this._tokenIdBuf.slice());
                        graphTxn.outputs.push({
                            address: address,
                            vout: slp_vout,
                            bchSatoshis: slp_vout < txn.outputs.length ? txn.outputs[slp_vout].satoshis : address ? 0 : null, 
                            slpAmount: graphTxn.details.sendOutputs![slp_vout],
                            spendTxid: null,
                            status: address ? TokenUtxoStatus.UNSPENT : TokenUtxoStatus.MISSING_BCH_VOUT,
                            invalidReason: address ? null : "Transaction is missing output."
                        });
                    }
                }
                slp_vout++;
            }
        }
        else {
            console.log("[WARNING]: Transaction is not valid or is unknown token type!", txid);
        }

        // check for possible inputs burned due to outputs < inputs
        if (SlpTransactionType.GENESIS !== graphTxn.details.transactionType) {
            let outputQty = graphTxn.outputs.reduce((a, c) => a.plus(c.slpAmount), new BigNumber(0));
            let inputQty = graphTxn.inputs.reduce((a, c) => a.plus(c.slpAmount), new BigNumber(0));
            if (outputQty.isGreaterThan(inputQty) && SlpTransactionType.MINT !== graphTxn.details.transactionType) {
                console.log(`[WARN] Graph item cannot have inputs less than outputs (txid: ${txid}, inputs: ${inputQty.toFixed()} | ${graphTxn.inputs.length}, outputs: ${outputQty.toFixed()} | ${graphTxn.outputs.length}).`);
                //throw Error(`Graph item cannot have inputs less than outputs (txid: ${txid}, inputs: ${inputQty.toFixed()} | ${graphTxn.inputs.length}, outputs: ${outputQty.toFixed()} | ${graphTxn.outputs.length}).`);
            }
            if (inputQty.isGreaterThan(outputQty)) {
                graphTxn.outputs.push(<any>{
                    slpAmount: inputQty.minus(outputQty),
                    status: TokenUtxoStatus.EXCESS_INPUT_BURNED
                });
            }
        }

        if(!processUpToBlock) {
            this._lastUpdatedBlock = this._manager._bestBlockHeight; //await this._rpcClient.getBlockCount();
        } else {
            this._lastUpdatedBlock = processUpToBlock;
        }

        this._graphTxns.setDirty(txid, graphTxn);

        if (!blockHash) {
            this.mempoolCommitToDb({ zmqTxid: txid });
        }

        return true;
    }

    public async removeGraphTransaction({ txid }: { txid: string }) {
        if (!this._graphTxns.has(txid)) {
            return;
        }

        // update status of inputs to UNSPENT or BATON_UNSPENT 
        let gt = this._graphTxns.get(txid)!;
        for (let input of gt.inputs) {
            let gti = this._graphTxns.get(input.txid);
            if (gti) {
                let outs = gti.outputs.filter(o => o.spendTxid === txid);
                outs.forEach(o => {
                    if ([SlpTransactionType.GENESIS, SlpTransactionType.MINT].includes(gti!.details.transactionType) && 
                        o.vout === gti!.details.batonVout) 
                    {
                        o.spendTxid = null;
                        o.status = BatonUtxoStatus.BATON_UNSPENT;
                        globalUtxoSet.set(`${txid}:${o.vout}`, this._tokenIdBuf.slice());
                        this._graphTxns.setDirty(input.txid);
                    } else {
                        o.spendTxid = null;
                        o.status = TokenUtxoStatus.UNSPENT;
                        globalUtxoSet.set(`${txid}:${o.vout}`, this._tokenIdBuf.slice());
                        this._graphTxns.setDirty(input.txid);
                    }
                });
            }
        }
        this._graphTxns.delete(txid);
    }

    private getAddressStringFromTxnOutput(txn: bitcore.Transaction, outputIndex: number) {
        let address;
        try {
            address = Utils.toSlpAddress(bitbox.Address.fromOutputScript(txn.outputs[outputIndex]._scriptBuffer, this._network));
        }
        catch (_) {
            try {
                address = 'scriptPubKey:' + txn.outputs[outputIndex]._scriptBuffer.toString('hex');
            }
            catch (_) {
                address = null;
            }
        }
        return address;
    }

    private async mempoolCommitToDb({ zmqTxid }: { zmqTxid?: string }): Promise<void> {
        if (zmqTxid) {
            this._graphUpdateQueueNewTxids.add(zmqTxid);
        }
        if (!this._graphUpdateQueueOnIdle) {
            this._updateComplete = false;
            this._graphUpdateQueueOnIdle = async (self: SlpTokenGraph) => {
                if (self._graphUpdateQueue.size !== 0 || self._graphUpdateQueue.pending !== 0) {
                    await self._graphUpdateQueue.onIdle();
                }
                self._graphUpdateQueue.pause();
                let txidToUpdate = Array.from(self._graphUpdateQueueNewTxids);
                self._graphUpdateQueueNewTxids.clear();
                self._graphUpdateQueueOnIdle = null;
                self._updateComplete = false;
                await self.commitToDb();
                while (txidToUpdate.length > 0) {
                    await self._manager.publishZmqNotificationGraphs(txidToUpdate.pop()!);
                }
                self._graphUpdateQueueOnIdle = undefined;
                self._graphUpdateQueue.start();
                return;
            }
            return this._graphUpdateQueueOnIdle(this); // Do not await this
        }
        return;
    }

    // static FormatUnixToDateString(unix_time: number): string {
    //     var date = new Date(unix_time*1000);
    //     return date.toISOString().replace("T", " ").replace(".000Z", "")
    // }

    public static MapDbTokenDetailsFromDbo(details: SlpTransactionDetailsDbo, decimals: number): SlpTransactionDetails {

        let genesisMintQty = new BigNumber(0);
        if(details.genesisOrMintQuantity)
            genesisMintQty = new BigNumber(details.genesisOrMintQuantity.toString()).multipliedBy(10**decimals);
        
        let sendOutputs: BigNumber[] = [];
        if(details.sendOutputs)
            sendOutputs = details.sendOutputs.map(o => o = <any>new BigNumber(o.toString()).multipliedBy(10**decimals));

        let res = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp!,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256: details.documentSha256Hex ? Buffer.from(details.documentSha256Hex, 'hex') : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton,
            genesisOrMintQuantity: details.genesisOrMintQuantity ? genesisMintQty : null,
            sendOutputs: details.sendOutputs ? sendOutputs as any as BigNumber[] : null
        }

        return res;
    }
}

// export interface AddressBalance {
//     token_balance: BigNumber; 
//     satoshis_balance: number;
// }

interface SpendDetails {
    status: TokenUtxoStatus;
    txid: string|null;
    invalidReason: string|null;
}

interface MintSpendDetails {
    status: BatonUtxoStatus;
    txid: string|null;
    invalidReason: string|null;
}

interface SpentTxos {
    txid: string;
    block: number|null;
    blockHash: Buffer|null;
}
