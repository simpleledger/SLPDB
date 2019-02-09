import { SlpTransactionDetails, SlpTransactionType, SlpVersionType, Slp, LocalValidator, BitcoreTransaction } from 'slpjs';
import BigNumber from "bignumber.js";
import { Bitcore, BitcoinRpc } from './vendor';
import BITBOXSDK from 'bitbox-sdk/lib/bitbox-sdk';
import { VerboseRawTransaction } from 'bitbox-sdk/lib/RawTransactions';

const bitcore = require('bitcore-lib-cash');
const BufferReader = require('bufio/lib/reader');
const Block = require('bcash/lib/primitives/block');

export interface TokenGraph {
    tokenDetails: SlpTransactionDetails;
    tokenStats: TokenStats;
    _txnGraph: Map<txid, GraphTxn>;
    _addresses: Map<hash160, { token_balance_cramers: BigNumber, bch_balance_satoshis: BigNumber }>;
    buildTokenGraphFrom(txid: string): Promise<boolean>;
    computeStatistics(): Promise<boolean>;
    // addTokenTransaction(txnhex: string);
    // toJSON();
    // fromJSON(json: string);
}

interface GraphTxn {
    details: SlpTransactionDetails;
    validSlp: boolean;
    invalidReason?: string;
    outputs: { 
        vout: number, 
        bchAmout: number, 
        slpAmount: BigNumber, 
        spendTxid: string|null }[]
}

type txid = string;
type hash160 = string;

interface TokenStats {
    date_last_active_send: Date;
    date_last_active_mint: Date;
    qty_valid_txns_since_genesis: number;
    qty_utxos_holding_valid_tokens: number;
    qty_bch_holding_valid_tokens: number;
    qty_token_minted: BigNumber;
    qty_token_burned: BigNumber;
    qty_token_unburned: BigNumber;
}

export class SlpTokenGraph implements TokenGraph {
    tokenDetails: SlpTransactionDetails;    
    tokenStats: TokenStats;
    tokenUtxos: Set<string>;
    _txnGraph: Map<string, GraphTxn>;
    _addresses: Map<string, { token_balance_cramers: BigNumber; bch_balance_satoshis: BigNumber; }>;
    _getRawTransaction?: (txid: string, verbose: boolean) => Promise<string|VerboseRawTransaction>;
    _getTxOut?: (txid: string, vout: number, includemempool: boolean) => Promise<BitcoinRpc.VerboseTxOut|null>;
    _getBlock?: (hash: string, verbose: boolean) => Promise<BitcoinRpc.RpcBlockInfo|string>;
    _getBlockHash?: (index: number) => Promise<string>;
    _getBlockCount?: () => Promise<number>;
    _slpValidator: LocalValidator;


    constructor(tokenDetails: SlpTransactionDetails, 
                getRawTransaction?: (txid: string, verbose: boolean) => Promise<string|VerboseRawTransaction>, 
                getTxOut?: (txid: string) => Promise<BitcoinRpc.VerboseTxOut|null>,
                getBlock?: (hash: string, verbose: boolean) => Promise<BitcoinRpc.RpcBlockInfo|string>,
                getBlockHash?: (index: number) => Promise<string>,
                getBlockCount?: () => Promise<number>
    )
    {
        if(tokenDetails.transactionType !== SlpTransactionType.GENESIS)
            throw Error("Cannot create a new token graph without providing GENESIS token details")
        this.tokenDetails = tokenDetails;
        this._getRawTransaction = getRawTransaction;
        this._getTxOut = getTxOut;
        this._getBlock = getBlock;
        this._getBlockHash = getBlockHash;
        this._getBlockCount = getBlockCount;
        const BITBOX = new BITBOXSDK();
        this._slpValidator = new LocalValidator(BITBOX, async (txids) => [ <string>await this._getRawTransaction(txids[0], false) ])
    }

    async asyncForEach(array, callback) {
        for (let index = 0; index < array.length; index++) {
          await callback(array[index], index, array);
        }
    }

    async processTokenTxoState(txid: string, vout: number): Promise<txid|null> {
        let txBuf = Buffer.from(txid, 'hex');
        let txOut = await this._getTxOut(txid, vout, false)
        if(!txOut) {
            let txn = <VerboseRawTransaction>(await this._getRawTransaction(txid, true));
            if(txn.confirmations > 0) {
                let blockIndex = (<BitcoinRpc.RpcBlockInfo>(await this._getBlock(txn.blockhash, true))).height;
                let currentHeight = await this._getBlockCount()
                let blockHash = txn.blockhash;
                let spentInTxid;
                while(!spentInTxid && blockIndex <= currentHeight) {
                    let blockhex = <string>(await this._getBlock(blockHash, false))
                    // parse all transactions
                    let block = Block.fromReader(new BufferReader(Buffer.from(blockhex, 'hex')));
                    block.txn.forEach((txn: Bitcore.Transaction) => { 
                        let spend = txn.inputs.find(i => i.prevTxId.equals(txBuf) && i.outputIndex === vout)
                        if(!spend) {
                            console.log("[GRAPH]", txid + ":" + vout, "spent in", txn.id);
                            this.tokenUtxos.delete(txid + ":" + vout)
                            return txn.id;
                        }
                    });
                    blockHash = await this._getBlockHash(++blockIndex);
                    currentHeight =  await this._getBlockCount();
                }
            }
        }
        this.tokenUtxos.add(txid + ":" + vout);
        return null;
    }

    async buildTokenGraphFrom(txid: string): Promise<boolean> {
        if(!this._getRawTransaction)
            throw Error("Cannot build txn without fetch RPC data methods set.")

        if(txid === this.tokenDetails.tokenIdHex) {
            this._txnGraph.clear();
        }

        let isValid = await this._slpValidator.isValidSlpTxid(txid)
        let graph: GraphTxn = { details: this._slpValidator.cachedValidations[txid].details, validSlp: isValid, outputs: [] }

        let txn: Bitcore.Transaction = new bitcore.Transaction(this._slpValidator.cachedRawTransactions[this.tokenDetails.tokenIdHex])
        
        // Create SLP graph outputs for each valid SLP output
        await this.asyncForEach(graph.details.sendOutputs, async (output, vout) => { 
            if(output.isGreaterThan(0) && isValid) {
                let spendTxid = await this.processTokenTxoState(this.tokenDetails.tokenIdHex, vout)
                graph.outputs.push({
                    vout: vout,
                    bchAmout: txn.outputs[vout].satoshis, 
                    slpAmount: graph.details.sendOutputs[vout],
                    spendTxid: spendTxid
                })
            }
        })

        this._txnGraph.set(txid, graph);

        // Recursively map out the outputs
        graph.outputs.filter(o => o.spendTxid !== null).forEach((o) => {
            this.buildTokenGraphFrom(o.spendTxid);
        })

        this._txnGraph.set(this.tokenDetails.tokenIdHex, graph);
        return true;
    }

    computeStatistics(): Promise<boolean> {
        throw new Error("Method not implemented.");
    }
}


