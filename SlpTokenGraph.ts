/// <reference path="./vendor/bignumber.js/bignumber.d.ts" />

import { SlpTransactionDetails, SlpTransactionType, Slp, LocalValidator } from 'slpjs';
import BigNumber from "./vendor/bignumber.js";
//import BigNumberOld from "bignumber.js";
import { Bitcore, BitcoinRpc } from './vendor';
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import { Config } from './config';
import * as bitcore from 'bitcore-lib-cash';

const RpcClient = require('bitcoin-rpc-promise')
const bitqueryd = require('fountainhead-bitqueryd')
const BITBOX = new BITBOXSDK();

export interface TokenGraph {
    _tokenDetails: SlpTransactionDetails;
    _tokenStats: TokenStats;
    _tokenUtxos: Set<string>;
    _txnGraph: Map<txid, GraphTxn>;
    _addresses: Map<cashAddr, AddressBalance>;
    updateTokenGraphFrom(txid: string): Promise<boolean>;
    initStatistics(): Promise<void>;
}

export interface AddressBalance {
    token_balance: BigNumber, bch_balance_satoshis: number
}

export class SlpTokenGraph implements TokenGraph {
    _lastUpdatedBlock!: number;
    _tokenDetails!: SlpTransactionDetails;
    _tokenStats!: TokenStats;
    _tokenUtxos!: Set<string>;
    _txnGraph!: Map<string, GraphTxn>;
    _addresses!: Map<cashAddr, AddressBalance>;
    _slpValidator!: LocalValidator;
    _rpcClient: BitcoinRpc.RpcClient;
    _dbQuery!: any

    constructor() {
        let connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
        this._rpcClient = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
        this._slpValidator = new LocalValidator(BITBOX, async (txids) => [ await this._rpcClient.getRawTransaction(txids[0]) ])
    }

    async initFromScratch(tokenDetails: SlpTransactionDetails) {
        this._lastUpdatedBlock = 0;
        this._dbQuery = await bitqueryd.init({ url: Config.db.url });
        this._tokenDetails = tokenDetails;
        this._tokenUtxos = new Set<string>();
        this._txnGraph = new Map<string, GraphTxn>();
        this._addresses = new Map<cashAddr, AddressBalance>();

        await this.updateTokenGraphFrom(tokenDetails.tokenIdHex);
        let mints = await this.getMintTransactions();
        if(mints && mints.length > 0)
            mints.forEach(async m => await this.updateTokenGraphFrom(m.txid!));

        await this.updateAddresses();
        await this.initStatistics();

        // TODO? creaete rpc cache, and then clear rpc cache here.
    }

    IsValid(): boolean {
        return this._txnGraph.has(this._tokenDetails.tokenIdHex);
    }

    async asyncForEach(array: any[], callback: Function) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async queryForTxoInput(txid: string, vout: number): Promise<TxnQueryResult> {
        let q = {
            "v": 3,
            "q": {
                "find": { 
                    "in": {
                        "$elemMatch": { "e.h": txid, "e.i": vout }
                    }
                }   
            },
            "r": { "f": "[ .[] | { txid: .tx.h, block: (if .blk? then .blk.i else null end), timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), tokenid: .out[0].h4, slp1: .out[0].h5, slp2: .out[0].h6, slp3: .out[0].h7, slp4: .out[0].h8, slp5: .out[0].h9, slp6: .out[0].h10, slp7: .out[0].h11, slp8: .out[0].h12, slp9: .out[0].h13, slp10: .out[0].h14, slp11: .out[0].h15, slp12: .out[0].h16, slp13: .out[0].h17, slp14: .out[0].h18, slp15: .out[0].h19, slp16: .out[0].h20, slp17: .out[0].h21, slp18: .out[0].h22, slp19: .out[0].h23, bch0: .out[0].e.v, bch1: .out[1].e.v, bch2: .out[2].e.v, bch3: .out[3].e.v, bch4: .out[4].e.v, bch5: .out[5].e.v, bch6: .out[6].e.v, bch7: .out[7].e.v, bch8: .out[8].e.v, bch9: .out[9].e.v, bch10: .out[10].e.v, bch11: .out[11].e.v, bch12: .out[12].e.v, bch13: .out[13].e.v, bch14: .out[14].e.v, bch15: .out[15].e.v, bch16: .out[16].e.v, bch17: .out[17].e.v, bch18: .out[18].e.v, bch19: .out[19].e.v } ]" }
        }

        let response: TxnQueryResponse = await this._dbQuery.read(q);
        
        if(!response.errors) {
            let results: TxnQueryResult[] = ([].concat(<any>response.c).concat(<any>response.u));
            if(results.length === 1) {
                let res: any = results[0];
                let sendOutputs: { tokenQty: BigNumber, satoshis: number }[] = [];
                res.sendOutputs = sendOutputs;
                res.sendOutputs.push({ tokenQty: new BigNumber(0), satoshis: res.bch0 });
                let keys = Object.keys(res);
                keys.forEach((key, index) => {
                    if(res[key] && key.includes('slp')) {
                        try {
                            let qtyBuf = Buffer.from(res[key], 'hex');
                            res.sendOutputs.push({ tokenQty: (new BigNumber(qtyBuf.readUInt32BE(0).toString())).multipliedBy(2**32).plus(new BigNumber(qtyBuf.readUInt32BE(4).toString())), satoshis: res["bch" + key.replace('slp', '')] });
                        } catch(err) { 
                            throw err;
                        }
                    }
                })
                return res;
            }
            else {
                console.log("Assumed Token Burn: Could not find the spend transaction: " + txid + ":" + vout);
                return { tokenid: null, txid: null, block: null, timestamp: null, sendOutputs: [ { tokenQty: new BigNumber(0), satoshis: 0} ] }
            }
        }
        throw Error("Mongo DB ERROR.")
    }

    async getSpendDetails(txid: string, vout: number): Promise<SpendDetails> {
        let txOut = await this._rpcClient.getTxOut(txid, vout, true);
        //console.log("TXOUT", txOut);
        if(txOut === null) {
            this._tokenUtxos.delete(txid + ":" + vout);
            //console.log("DELETE:", txid,":",vout);
            try {
                let spendTxnInfo = await this.queryForTxoInput(txid, vout);

                if(spendTxnInfo.txid === null) {
                    return { status: UtxoStatus.SPENT_NON_SLP, txid: null, queryResponse: null };
                }
                if(typeof spendTxnInfo!.txid === 'string') {
                    if(this._tokenDetails.tokenIdHex === spendTxnInfo.tokenid) {
                        return { status: UtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo };
                    }
                    return { status: UtxoStatus.SPENT_WRONG_TOKEN, txid: null, queryResponse: spendTxnInfo };
                }
            } catch(_) {
                return { status: UtxoStatus.SPENT_INVALID_SLP, txid: null, queryResponse: null };
            }
        } 
        else {
            this._tokenUtxos.add(txid + ":" + vout);
            //console.log("ADD:", txid,":",vout);
            return { status: UtxoStatus.UNSPENT, txid: null, queryResponse: null };
        }

        throw Error("Unknown Error in SlpTokenGraph");
    }

    async updateTokenGraphFrom(txid: string, isParent=false): Promise<boolean> {        
        if(this._txnGraph.has(txid) && !isParent)
            return true;

        let isValid = await this._slpValidator.isValidSlpTxid(txid)
        let txnDetails = this._slpValidator.cachedValidations[txid].details;
        let txn: Bitcore.Transaction = new bitcore.Transaction(this._slpValidator.cachedRawTransactions[txid])

        if (!isValid || !txnDetails) {
            console.log("not valid or no Txn details", txid);
            return false;
        }

        let graphTxn: GraphTxn;
        if(!this._txnGraph.has(txid))
            graphTxn = { details: txnDetails, validSlp: isValid!, outputs: [] }
        else {
            graphTxn = this._txnGraph.get(txid)!;
            graphTxn.outputs = [];
        }

        // First, lets update the status of the txn's input TXO parents
        if(!isParent) {
            let parentIds = new Set<string>([...txn.inputs.map(i => i.prevTxId.toString('hex'))])
            await this.asyncForEach(Array.from(parentIds), async (txid: string) => {
                if(this._txnGraph.get(txid)!) {
                    await this.updateTokenGraphFrom(txid, true);
                }
            });
        }

        // Create SLP graph outputs for each new valid SLP output
        if(isValid && (graphTxn.details.transactionType === SlpTransactionType.GENESIS || graphTxn.details.transactionType === SlpTransactionType.MINT)) {
            if(graphTxn.details.genesisOrMintQuantity!.isGreaterThanOrEqualTo(0)) {
                let spendDetails = await this.getSpendDetails(txid, 1)
                graphTxn.outputs.push({
                    vout: 1,
                    bchAmout: txn.outputs[1].satoshis, 
                    slpAmount: <any>graphTxn.details.genesisOrMintQuantity!,
                    spendTxid: spendDetails.txid,
                    status: spendDetails.status
                })
            }
        }
        else if(isValid && graphTxn.details.sendOutputs!.length > 0) {
            await this.asyncForEach(graphTxn.details.sendOutputs!, async (output: BigNumber, vout: number) => { 
                if(output.isGreaterThanOrEqualTo(0)) {
                    if(vout > 0) {
                        let spendDetails = await this.getSpendDetails(txid, vout)
                        graphTxn.outputs.push({
                            vout: vout,
                            bchAmout: txn.outputs[vout].satoshis, 
                            slpAmount: <any>graphTxn.details.sendOutputs![vout],
                            spendTxid: spendDetails.txid,
                            status: spendDetails.status
                        })
                    }
                }
            })
        }
        else {
            console.log("[WARNING]: Transaction is not valid or is unknown token type!", txid)
        }

        // Continue to complete graph from output UTXOs
        if(!isParent) {
            await this.asyncForEach(graphTxn.outputs.filter(o => o.spendTxid && o.status === UtxoStatus.SPENT_SAME_TOKEN), async (o: any) => {
                await this.updateTokenGraphFrom(o.spendTxid!);
            });
        }

        this._txnGraph.set(txid, graphTxn);
        this._lastUpdatedBlock = await this._rpcClient.getBlockCount();
        return true;
    }

    async updateAddresses() {
        this._addresses.clear();

        await this.asyncForEach(Array.from(this._tokenUtxos), async (utxo: string) => {
            let txid = utxo.split(':')[0];
            let vout = parseInt(utxo.split(':')[1]);
            let txout = <BitcoinRpc.VerboseTxOut>(await this._rpcClient.getTxOut(txid, vout, true))
            if(txout) {
                let bal;
                let addr = txout.scriptPubKey.addresses[0]
                let txnDetails = this._txnGraph.get(txid)!.details
                if(this._addresses.has(addr)) {
                    bal = this._addresses.get(addr)!
                    bal.bch_balance_satoshis+=txout.value*10**8
                    if(txnDetails.transactionType === SlpTransactionType.SEND)
                        bal.token_balance = bal.token_balance.plus(txnDetails.sendOutputs![vout])
                    else if(vout === 1)
                        bal.token_balance = bal.token_balance.plus(txnDetails.genesisOrMintQuantity!)
                }
                else {
                    if(txnDetails.transactionType === SlpTransactionType.SEND)
                        bal = { bch_balance_satoshis: txout.value*10**8, token_balance: txnDetails.sendOutputs![vout] }
                    else if(vout === 1)
                        bal = { bch_balance_satoshis: txout.value*10**8, token_balance: txnDetails.genesisOrMintQuantity! }
                }

                if(bal) {
                    this._addresses.set(addr, <any>bal);
                }
            }
        });
    }

    async getMintTransactions(): Promise<MintQueryResult[]|null> {
        let q = {
            "v": 3,
            "q": {
                "find": { "out.h1": "534c5000", "out.s3": "MINT", "out.h4": this._tokenDetails.tokenIdHex }
            },
            "r": { "f": "[ .[] | { txid: .tx.h, versionTypeHex: .out[0].h2, block: (if .blk? then .blk.i else null end), timestamp: (if .blk? then (.blk.t | strftime(\"%Y-%m-%d %H:%M\")) else null end), batonHex: .out[0].h5, quantityHex: .out[0].h6 } ]" }
        }

        let res: TxnQueryResponse = await this._dbQuery.read(q);
        
        if(!res.errors) {
            let results: MintQueryResult[] = [];
            [ ...([].concat(<any>res.c).concat(<any>res.u))].forEach((res: MintQueryResult) => {
                let i = results.findIndex(r => r.txid === res.txid);
                if(i <= -1)
                    results.push(res);
            });
            if(results.length > 0) {
                return results;
            }
        }
        return null;
    }

    async getTotalMintQuantity(): Promise<BigNumber> {
        let qty = this._tokenDetails.genesisOrMintQuantity!;
        let results = await this.getMintTransactions();
        if(results) {
            results.forEach(r => {
                if(r.quantityHex) {
                    let qtyBuf = new Buffer(r.quantityHex, 'hex');
                    let mint = (new BigNumber(qtyBuf.readUInt32BE(0).toString())).multipliedBy(2**32).plus(new BigNumber(qtyBuf.readUInt32BE(4).toString()));
                    //console.log("MINT AMOUNT", mint.toString())
                    qty = qty.plus(<any>mint);
                }
            })
        }
        return <any>qty;
    }

    getTotalHeldByAddresses(){
        let qty = new BigNumber(0);
        this._addresses.forEach(a => qty = qty.plus(a.token_balance))
        return qty;
    }

    getTotalSatoshisLockedUp(){
        let qty = 0;
        this._addresses.forEach(a => qty+=a.bch_balance_satoshis);
        return Math.round(qty);
    }

    async initStatistics(): Promise<void> {
        this._tokenStats = <TokenStats> {
            block_created: 0,
            block_last_active_mint: 0,
            block_last_active_send: 0,
            qty_valid_txns_since_genesis: this._txnGraph.size,
            qty_valid_token_utxos: this._tokenUtxos.size,
            qty_valid_token_addresses: this._addresses.size,
            qty_token_minted: await this.getTotalMintQuantity(),
            qty_token_burned: new BigNumber(0),
            qty_token_circulating_supply: this.getTotalHeldByAddresses(),
            qty_satoshis_locked_up: this.getTotalSatoshisLockedUp()
        }

        this._tokenStats.qty_token_burned = this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_circulating_supply)
    }

    async updateStatistics(): Promise<void> {
        await this.updateAddresses();
        if(!this._tokenStats)
            await this.initStatistics();
        else {
            this._tokenStats.qty_valid_token_addresses = this._addresses.size;
            this._tokenStats.qty_valid_token_utxos = this._tokenUtxos.size;
            this._tokenStats.qty_valid_txns_since_genesis = this._txnGraph.size;
            this._tokenStats.qty_token_minted = await this.getTotalMintQuantity();
            this._tokenStats.qty_token_circulating_supply = this.getTotalHeldByAddresses();
            this._tokenStats.qty_token_burned = this._tokenStats.qty_token_minted.minus(this._tokenStats.qty_token_circulating_supply);
            this._tokenStats.qty_satoshis_locked_up = this.getTotalSatoshisLockedUp();
        }
    }

    getTokenStats() {
        return {
            block_created: "NA",                //this._tokenStats.block_created,
            block_last_active_mint: "NA",       //this._tokenStats.block_last_active_mint,
            block_last_active_send: "NA",       //this._tokenStats.block_last_active_send,
            qty_valid_txns_since_genesis: this._tokenStats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: this._tokenStats.qty_valid_token_utxos,
            qty_valid_token_addresses: this._tokenStats.qty_valid_token_addresses,
            qty_token_minted: this._tokenStats.qty_token_minted.toNumber(),
            qty_token_burned: this._tokenStats.qty_token_burned.toNumber(),
            qty_token_circulating_supply: this._tokenStats.qty_token_circulating_supply.toNumber(),
            qty_satoshis_locked_up: this._tokenStats.qty_satoshis_locked_up
        }
    }

    getAddresses() {
        return Array.from(this._addresses).map((v, _, __) => { return { addr: v[0], bal: v[1].token_balance.dividedBy(10**this._tokenDetails.decimals).toString() }})
    }

    toDbObject() {
        let tokenDetails = SlpTokenGraph.MapTokenDetailsToDbo(this._tokenDetails);
        let txnGraph = new Map<txid, GraphTxnDb>();
        this._txnGraph.forEach((g, k) => {
            txnGraph.set(k, { 
                details: SlpTokenGraph.MapTokenDetailsToDbo(this._txnGraph.get(k)!.details),
                outputs: this._txnGraph.get(k)!.outputs,
                validSlp: true,
                invalidReason: this._txnGraph.get(k)!.invalidReason
            })
        })
        //console.log("TO DB OBJECT (ORG) UTXOS:", this._tokenUtxos);
        let result = {
            lastUpdatedBlock: this._lastUpdatedBlock,
            tokenDetails: tokenDetails,
            txnGraph: txnGraph,
            addresses: this._addresses,
            tokenStats: this._tokenStats,
            tokenUtxos: Array.from(this._tokenUtxos)
        }
        return result;
    }

    static MapTokenDetailsToDbo(details: SlpTransactionDetails): SlpTransactionDetailsDb {
        let res: SlpTransactionDetailsDb = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256Hex: details.documentSha256 ? details.documentSha256.toString('hex')! : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton,
            genesisOrMintQuantity: details.genesisOrMintQuantity,
            sendOutputs: <BigNumber.Object[]>details.sendOutputs
        }

        return res;
    }

    static MapDbTokenDetails(details: SlpTransactionDetailsDb): SlpTransactionDetails {
        let res = {
            decimals: details.decimals,
            tokenIdHex: details.tokenIdHex,
            timestamp: details.timestamp,
            transactionType: details.transactionType,
            versionType: details.versionType,
            documentUri: details.documentUri,
            documentSha256: details.documentSha256Hex ? new Buffer(details.documentSha256Hex) : null,
            symbol: details.symbol,
            name: details.name,
            batonVout: details.batonVout,
            containsBaton: details.containsBaton,
            genesisOrMintQuantity: details.genesisOrMintQuantity? <any>new BigNumber(details.genesisOrMintQuantity) : null,
            sendOutputs: details.sendOutputs ? details.sendOutputs.map(o => <any>new BigNumber(o)) : null
        }

        return res;
    }

    static async FromDbObject(doc: TokenDBObject): Promise<SlpTokenGraph> {
        let tg = new SlpTokenGraph();
        tg._dbQuery = await bitqueryd.init({ url: Config.db.url });

        // Map _tokenDetails
        tg._tokenDetails = this.MapDbTokenDetails(doc.tokenDetails);

        // Map _txnGraph
        tg._txnGraph = new Map<txid, GraphTxn>();
        let txnKeys = Object.keys(doc.txnGraph)
        txnKeys.forEach(k => {
            let gt: GraphTxn = {
                details: this.MapDbTokenDetails(doc.txnGraph[k].details),
                validSlp: true,
                outputs: doc.txnGraph[k].outputs.map(o => <any>new BigNumber(o.slpAmount))
            }

            tg._txnGraph.set(k, gt);
        })

        // Map _addresses
        tg._addresses = new Map<string, AddressBalance>();
        let addrKeys = Object.keys(doc.addresses);
        addrKeys.forEach(k => {
            tg._addresses.set(k, {
                bch_balance_satoshis: doc.addresses[k].bch_balance_satoshis, 
                token_balance: new BigNumber(doc.addresses[k].token_balance) 
            });
        });

        // Map _tokenStats
        tg._tokenStats = {
            qty_token_minted: new BigNumber(doc.tokenStats.qty_token_minted),
            qty_token_burned: new BigNumber(doc.tokenStats.qty_token_burned),
            qty_token_circulating_supply: new BigNumber(doc.tokenStats.qty_token_circulating_supply),
            qty_satoshis_locked_up: doc.tokenStats.qty_satoshis_locked_up,
            qty_valid_txns_since_genesis: doc.tokenStats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: doc.tokenStats.qty_valid_token_utxos,
            qty_valid_token_addresses: doc.tokenStats.qty_valid_token_addresses
        }

        // Map _lastUpdatedBlock
        tg._lastUpdatedBlock = doc.lastUpdatedBlock;

        // Map _tokenUtxos
        tg._tokenUtxos = new Set(doc.tokenUtxos);

        return tg;
    }
}

interface TokenDBObject {
    tokenDetails: SlpTransactionDetailsDb;
    txnGraph: { [txid: string]: GraphTxnDb };
    addresses: { [cashAddr: string]: { bch_balance_satoshis: number, token_balance: BigNumber.Object } };
    tokenStats: TokenStatsDb;
    lastUpdatedBlock: number;
    tokenUtxos: string[]
}

interface SlpTransactionDetailsDb {
    transactionType: SlpTransactionType;
    tokenIdHex: string;
    versionType: number;
    timestamp: string;
    symbol: string;
    name: string;
    documentUri: string; 
    documentSha256Hex: string|null;
    decimals: number;
    containsBaton: boolean;
    batonVout: number|null;
    genesisOrMintQuantity: BigNumber.Object|null;
    sendOutputs: BigNumber.Object[]|null;
}

interface GraphTxnDb {
    details: SlpTransactionDetailsDb;
    validSlp: boolean;
    invalidReason?: string;
    outputs: { 
        vout: number, 
        bchAmout: number, 
        slpAmount: BigNumber.Object, 
        spendTxid: string|null,
        status: UtxoStatus }[],
}

interface GraphTxn {
    details: SlpTransactionDetails;
    validSlp: boolean;
    invalidReason?: string;
    outputs: { 
        vout: number, 
        bchAmout: number, 
        slpAmount: BigNumber, 
        spendTxid: string|null,
        status: UtxoStatus }[],
}

type txid = string;
type cashAddr = string;

interface TokenStats {
    block_created?: number;
    block_last_active_send?: number;
    block_last_active_mint?: number;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: BigNumber;
    qty_token_burned: BigNumber;
    qty_token_circulating_supply: BigNumber;
    qty_satoshis_locked_up: number;
}

interface TokenStatsDb {
    block_created: number;
    block_last_active_send: number;
    block_last_active_mint: number;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: BigNumber.Object;
    qty_token_burned: BigNumber.Object;
    qty_token_circulating_supply: BigNumber.Object;
    qty_satoshis_locked_up: number;
}

enum UtxoStatus {
    "UNSPENT" = "UNSPENT", 
    "SPENT_SAME_TOKEN" = "SPENT_SAME_TOKEN",
    "SPENT_WRONG_TOKEN" = "SPENT_WRONG_TOKEN", 
    "SPENT_NON_SLP" = "SPENT_NON_SLP",
    "SPENT_INVALID_SLP" = "SPENT_INVALID_SLP"
}

interface SpendDetails {
    status: UtxoStatus;
    txid: string|null;
    queryResponse: TxnQueryResult|null;
}

export interface TxnQueryResponse {
    c: TxnQueryResult[],
    u: TxnQueryResult[], 
    errors?: any;
}

interface MintQueryResult {
    txid: string|null;
    block: number|null;
    timestamp: string|null;
    batonHex: string|null;
    quantityHex: string|null;
    versionTypeHex: string|null;
}

interface TxnQueryResult {
    sendOutputs: { tokenQty: BigNumber, satoshis: number }[];
    //input: {h: string, i: number, a: string };
    txid: string|null;
    block: number|null;
    timestamp: string|null;
    tokenid: string|null,
    bch0?: number;
    bch1?: number|null;
    bch2?: number|null;
    bch3?: number|null;
    bch4?: number|null;
    bch5?: number|null;
    bch6?: number|null;
    bch7?: number|null;
    bch8?: number|null;
    bch9?: number|null;
    bch10?: number|null;
    bch11?: number|null;
    bch12?: number|null;
    bch13?: number|null;
    bch14?: number|null;
    bch15?: number|null;
    bch16?: number|null;
    bch17?: number|null;
    bch18?: number|null;
    bch19?: number|null;
    slp0?: number;
    slp1?: number|null;
    slp2?: number|null;
    slp3?: number|null;
    slp4?: number|null;
    slp5?: number|null;
    slp6?: number|null;
    slp7?: number|null;
    slp8?: number|null;
    slp9?: number|null;
    slp10?: number|null;
    slp11?: number|null;
    slp12?: number|null;
    slp13?: number|null;
    slp14?: number|null;
    slp15?: number|null;
    slp16?: number|null;
    slp17?: number|null;
    slp18?: number|null;
    slp19?: number|null;
}

    // async getTotalBurnedQuantity(): Promise<BigNumber> {
    //     let burned = new BigNumber(0);
        
    //     // Add up the burned quantities resulting from non_slp txns 
    //     this._txnGraph.forEach(txn => {
    //         txn.outputs.forEach(o => {
    //             if(o.status !== UtxoStatus.UNSPENT && o.status !== UtxoStatus.SPENT_SAME_TOKEN)
    //                 burned = burned.plus(o.slpAmount);
    //         })
    //     })

    //     // Add up the amounts burned when SLP outputs is less than SLP inputs
    //     await this.asyncForEach(Array.from(this._txnGraph), async (gtxn: [string, GraphTxn]) => {
    //         //console.log("BURN CALC", gtxn[0])
    //         let txnhex: string;
    //         if(this._slpValidator.cachedRawTransactions[gtxn[0]])
    //             txnhex = this._slpValidator.cachedRawTransactions[gtxn[0]]
    //         else
    //             txnhex = await this._rpcClient.getRawTransaction(gtxn[0])

    //         let txn: Bitcore.Transaction = new bitcore.Transaction(txnhex)
    //         let inputs = txn.inputs.reduce((v, i) => {
    //             if(this._txnGraph.has(i.prevTxId.toString('hex'))) {
    //                 let intxn = this._txnGraph.get(i.prevTxId.toString('hex'))!
    //                 return v.plus(intxn.outputs.filter(o => o.spendTxid === gtxn[0]).reduce((w, j) => w.plus(j.slpAmount), new BigNumber(0)))
    //             }
    //             return v;
    //         }, new BigNumber(0))

    //         let outputs = gtxn[1].outputs.reduce((v, i)=> v.plus(i.slpAmount), new BigNumber(0))
    //         burned = burned.plus(outputs.minus(inputs));
    //     });

    //     return burned;
    // }
