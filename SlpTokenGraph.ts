import { SlpTransactionDetails, SlpTransactionType, Slp, LocalValidator } from 'slpjs';
import BigNumber from "bignumber.js";
import { Bitcore, BitcoinRpc } from './vendor';
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import { Config } from './config';
import * as bitcore from 'bitcore-lib-cash';

const RpcClient = require('bitcoin-rpc-promise')
const bitqueryd = require('fountainhead-bitqueryd')
const BITBOX = new BITBOXSDK();
const slp  = new Slp(BITBOX);


export interface TokenGraph {
    tokenDetails: SlpTransactionDetails;
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
    tokenDetails!: SlpTransactionDetails;
    _tokenStats!: TokenStats;
    _tokenUtxos!: Set<string>;
    _txnGraph!: Map<string, GraphTxn>;
    _addresses!: Map<cashAddr, AddressBalance>;
    _slpValidator!: LocalValidator;
    _rpcClient: BitcoinRpc.RpcClient;
    _db!: any

    constructor() {
        let connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
        this._rpcClient = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
        this._slpValidator = new LocalValidator(BITBOX, async (txids) => [ await this._rpcClient.getRawTransaction(txids[0]) ])
    }

    async init(tokenDetails: SlpTransactionDetails) {
        this._db = await bitqueryd.init();
        this.tokenDetails = tokenDetails;
        this._tokenUtxos = new Set<string>();
        this._txnGraph = new Map<string, GraphTxn>();
        this._addresses = new Map<cashAddr, AddressBalance>();
        await this.updateTokenGraphFrom(tokenDetails.tokenIdHex);
        await this.updateAddresses();
        await this.initStatistics();
        // TODO creaete rpc cache, and then clear rpc cache here.
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

        //console.log(q)

        let response: TxnQueryResponse = await this._db.read(q);
        
        if(!response.errors) {
            let results: TxnQueryResult[] = ([].concat(<any>response.c).concat(<any>response.u));
            //console.log("BitDB Response:", results);
            //results = results.filter(r => r.input.h === txid && r.input.i === vout)
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
                            console.log(err);
                            throw err;
                        }
                    }
                })
                //console.log("Bitdb Query Response = ", res)
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
        let txOut = await this._rpcClient.getTxOut(txid, vout, true)
        //console.log('TXOUT', txOut);
        if(txOut === null) {
            this._tokenUtxos.delete(txid + ":" + vout)
            let spendTxnInfo = await this.queryForTxoInput(txid, vout);
            //console.log("SPENDTXNINFO:", spendTxnInfo);
            if(spendTxnInfo.txid === null) {
                return { status: UtxoStatus.SPENT_NON_SLP, txid: null, queryResponse: null };
            }
            if(typeof spendTxnInfo!.txid === 'string') {
                if(this.tokenDetails.tokenIdHex === spendTxnInfo.tokenid) {
                    return { status: UtxoStatus.SPENT_SAME_TOKEN, txid: spendTxnInfo!.txid, queryResponse: spendTxnInfo };
                }
                return { status: UtxoStatus.SPENT_WRONG_TOKEN, txid: null, queryResponse: spendTxnInfo };
            }
            throw Error("Unknown Error in SlpTokenGraph")
        }
        //console.log('TXID', txid);
        this._tokenUtxos.add(txid + ":" + vout);
        return { status: UtxoStatus.UNSPENT, txid: null, queryResponse: null };
    }

    async updateTokenGraphFrom(txid: string): Promise<boolean> {
        if(this._txnGraph.has(txid))
            return true;

        let isValid = await this._slpValidator.isValidSlpTxid(txid)
        let txnDetails = this._slpValidator.cachedValidations[txid].details;

        if (!isValid || !txnDetails)
            return false;

        let graphTxn: GraphTxn = { details: <SlpTransactionDetails>txnDetails, validSlp: isValid!, outputs: [] }
        let txn: Bitcore.Transaction = new bitcore.Transaction(this._slpValidator.cachedRawTransactions[txid])
        
        // Create SLP graph outputs for each valid SLP output
        if(isValid && (graphTxn.details.transactionType === SlpTransactionType.GENESIS)) {
            if(graphTxn.details.genesisOrMintQuantity!.isGreaterThan(0)) {
                let spendDetails = await this.getSpendDetails(txid, 1)
                graphTxn.outputs.push({
                    vout: 1,
                    bchAmout: txn.outputs[1].satoshis, 
                    slpAmount: graphTxn.details.genesisOrMintQuantity!,
                    spendTxid: spendDetails.txid,
                    status: spendDetails.status
                })
            }
        }
        else if(isValid && graphTxn.details.sendOutputs!.length > 0) {
            await this.asyncForEach(graphTxn.details.sendOutputs!, async (output: BigNumber, vout: number) => { 
                if(output.isGreaterThan(0)) {
                    let spendDetails = await this.getSpendDetails(txid, vout)
                    graphTxn.outputs.push({
                        vout: vout,
                        bchAmout: txn.outputs[vout].satoshis, 
                        slpAmount: graphTxn.details.sendOutputs![vout],
                        spendTxid: spendDetails.txid,
                        status: spendDetails.status
                    })
                }
            })
        }
        else if(isValid && (graphTxn.details.transactionType === SlpTransactionType.GENESIS)) {
            console.log("[WARNING]: MINT graph transactions not handled yet!", txid)
        }
        else {
            console.log("[WARNING]: Transaction is not valid or is unknown token type!", txid)
        }

        await this.asyncForEach(graphTxn.outputs.filter(o => o.spendTxid && o.status === UtxoStatus.SPENT_SAME_TOKEN), async (o: any) => {
            //console.log("UPDATE FROM: ", o.spendTxid!);
            await this.updateTokenGraphFrom(o.spendTxid!);
        });

        //console.log("TOKEN GRAPH TXN UPDATE DONE:", txid);
        this._txnGraph.set(txid, graphTxn);

        //this._txnGraph.set(this.tokenDetails.tokenIdHex, graphTxn);
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

                if(bal)
                    this._addresses.set(addr, bal);
            }
        });
    }

    async initStatistics(): Promise<void> {
        this._tokenStats = <TokenStats> {
            block_created: 0,
            block_last_active_mint: 0,
            block_last_active_send: 0,
            qty_valid_txns_since_genesis: this._txnGraph.size,
            qty_valid_token_utxos: this._tokenUtxos.size,
            qty_valid_token_addresses: this._addresses.size,
            qty_token_minted: new BigNumber(0),
            qty_token_burned: new BigNumber(0),
            qty_token_unburned: new BigNumber(0),
            qty_satoshis_locked_up: 0
        }
    }

    async updateStatistics(): Promise<void> {
        await this.updateAddresses();
        if(!this._tokenStats)
            await this.initStatistics();
        else {
            this._tokenStats.qty_valid_token_addresses = this._addresses.size;
            this._tokenStats.qty_valid_token_utxos = this._tokenUtxos.size;
            this._tokenStats.qty_valid_txns_since_genesis = this._txnGraph.size;
        }
    }

    getTokenStats(){
        return {
            block_created: this._tokenStats.block_created,
            block_last_active_mint: this._tokenStats.block_last_active_mint,
            block_last_active_send: this._tokenStats.block_last_active_send,
            qty_valid_txns_since_genesis: this._tokenStats.qty_valid_txns_since_genesis,
            qty_valid_token_utxos: this._tokenStats.qty_valid_token_utxos,
            qty_valid_token_addresses: this._tokenStats.qty_valid_token_addresses,
            qty_token_minted: this._tokenStats.qty_token_minted.toNumber(),
            qty_token_burned: this._tokenStats.qty_token_burned.toNumber(),
            qty_token_unburned: this._tokenStats.qty_token_unburned.toNumber(),
            qty_satoshis_locked_up: this._tokenStats.qty_satoshis_locked_up
        }
    }

    getAddresses() {
        return Array.from(this._addresses).map((v, _, __) => { return { addr: v[0], bal: v[1].token_balance.dividedBy(10**this.tokenDetails.decimals).toString() }})
    }
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
    block_created: number;
    block_last_active_send: number;
    block_last_active_mint: number;
    qty_valid_txns_since_genesis: number;
    qty_valid_token_utxos: number;
    qty_valid_token_addresses: number;
    qty_token_minted: BigNumber;
    qty_token_burned: BigNumber;
    qty_token_unburned: BigNumber;
    qty_satoshis_locked_up: number;
}

enum UtxoStatus {
    "UNSPENT" = "UNSPENT", 
    "SPENT_SAME_TOKEN" = "SPENT_SAME_TOKEN",
    "SPENT_WRONG_TOKEN" = "SPENT_WRONG_TOKEN", 
    "SPENT_NON_SLP" = "SPENT_NON_SLP"
}

interface SpendDetails {
    status: UtxoStatus;
    txid: string|null;
    queryResponse: TxnQueryResult|null;
}

interface TxnQueryResponse {
    c: TxnQueryResult[],
    u: TxnQueryResult[], 
    errors?: any;
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


