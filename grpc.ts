// Example use of BCHD's gRPC bchrpc with nodejs. 

// NOTES: 
// 1. Using localhost requires `export NODE_TLS_REJECT_UNAUTHORIZED=0` 

import * as fs from 'fs';
import * as grpc from 'grpc';
import * as bchrpc from './pb/bchrpc_pb'
import * as bchrpc_grpc from './pb/bchrpc_grpc_pb';
import { VerboseRawTransactionResult, TxOutResult, NodeInfoResult, BlockchainInfoResult, BlockDetailsResult, MempoolInfoResult } from "bitcoin-com-rest";

const rootCert = fs.readFileSync('/Users/jamescramer/Library/Application\ Support/Bchd/rpc.cert');
const client = new bchrpc_grpc.bchrpcClient('localhost:8335', grpc.credentials.createSsl(rootCert));

export default class GrpcClient {

    _getMempoolInfo(): Promise<bchrpc.GetMempoolInfoResponse> {
        return new Promise((resolve, reject) => {
            client.getMempoolInfo(new bchrpc.GetMempoolInfoRequest(), (err, data) => {
                if (err !== null) reject(err);
                else resolve(data);
            });
        });
    }

    async getMempoolInfo(): Promise<MempoolInfoResult> {
        let res = await this._getMempoolInfo();
        
        return <any>{
            size: res.getSize(),
            bytes: res.getBytes(),
            usage: null,
            maxmempool: null,
            mempoolminfee: null
        }
    }

    _getRawTransaction(hash: string): Promise<bchrpc.GetRawTransactionResponse> {
        let req = new bchrpc.GetRawTransactionRequest();
        req.setHash(new Uint8Array(hash.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))).reverse());
        return new Promise((resolve, reject) => {
            client.getRawTransaction(req, (err, data) => {
                if(err!==null) reject(err);
                else resolve(data);
            })
        });
    }

    async getRawTransaction(hash: string): Promise<string> {
        return Buffer.from((await this._getRawTransaction(hash)).getTransaction_asU8()).toString('hex');
    }

    _getTransaction(hash: string): Promise<bchrpc.GetTransactionResponse> {
        let req = new bchrpc.GetTransactionRequest();
        req.setHash(new Uint8Array(hash.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))).reverse());
        return new Promise((resolve, reject) => {
            client.getTransaction(req, (err, data) => {
                if(err!==null) reject(err);
                else resolve(data);
            })
        })
    }

    async getTransaction(hash: string): Promise<VerboseRawTransactionResult> {
        let tx = (await this._getTransaction(hash)).getTransaction()!
        return <any>{
            txid: hash, 
            size: tx.getSize(),
            version: tx.getVersion(),
            locktime: tx.getLockTime(),
            vin: tx.getInputsList()!.map(input => { return { 
                    txid: Buffer.from(input.getOutpoint()!.getHash_asU8().reverse()).toString('hex'), 
                    vout: input.getOutpoint()!.getIndex(),
                    sequence: input.getSequence(),
                    scriptSig: { 
                        hex: Buffer.from(input.getSignatureScript_asU8()).toString('hex'),
                        asm: null
                    }
                }
            }),
            vout: tx.getOutputsList()!.map(output => { return {
                value: output.getValue(),
                n: output.getIndex(),
                scriptPubKey: { 
                    hex: Buffer.from(output.getPubkeyScript_asU8()).toString('hex'),
                    asm: null, 
                    reqSigs: null, 
                    type: output.getScriptClass(),  
                    addresses: [ output.getAddress() ]
                }
            }}),
            blockhash: Buffer.from(tx.getBlockHash_asU8().reverse()).toString(),
            confirmations: tx.getConfirmations(),
            time: tx.getTimestamp(),
            blocktime: null
        }
    }

    _getRawBlock(hash: string): Promise<bchrpc.GetRawBlockResponse> {
        let req = new bchrpc.GetRawBlockRequest();
        req.setHash(new Uint8Array(hash.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))).reverse());
        return new Promise((resolve, reject) => {
            client.getRawBlock(req, (err, data) => {
                if(err!==null) reject(err);
                else resolve(data);
            })
        })
    }

    async getRawBlock(hash: string): Promise<string> {
        let block = await this._getRawBlock(hash);
        return Buffer.from(block.getBlock_asU8().reverse()).toString('hex')
    }

    _getBlockInfo(index: number): Promise<bchrpc.GetBlockInfoResponse> {
        let req = new bchrpc.GetBlockInfoRequest()
        req.setHeight(index);
        return new Promise((resolve, reject) => {
            client.getBlockInfo(req, (err, data) => {
                if(err!==null) reject(err);
                else resolve(data);            
            })
        })
    }

    async getBlockHash(index: number): Promise<string> {
        return Buffer.from((await this._getBlockInfo(index))!.getInfo()!.getHash_asU8()).toString('hex')
    }

    _getBlockchainInfo(): Promise<bchrpc.GetBlockchainInfoResponse> {
        return new Promise((resolve, reject) => {
            client.getBlockchainInfo(new bchrpc.GetBlockchainInfoRequest(), (err, data) => {
                if(err!==null) reject(err);
                else resolve(data);
            })
        })
    }

    async getBlockCount(): Promise<number> {
        let res = await this._getBlockchainInfo();
        return res.getBestHeight();
    }

    // _getTxOut(hash: string, vout: number, includemempool): Promsie<bchrpc.UnspentOutput>{

    // }

    
    // async getTxOut(hash: string, vout: number, includemempool: boolean): Promise<TxOutResult|null> {
    //     console.log("[INFO] JSON RPC: getTxOut", hash, vout, includemempool);
    //     return await rpc.getTxOut(hash, vout, includemempool);
    // }

    // _getRawMemPool(): Promise<bchrpc.GetMempoolInfoResponse {
    //     let req = new bchrpc.GetMempoolInfoRequest();
    //     return new Promise((resolve, reject) => {
    //         client.getMempoolInfo(req, (err, data) =>)
    //     })

    // }
    // async getRawMemPool(): Promise<string[]> {
        
    // }

    // async getInfo(): Promise<NodeInfoResult> {
    //     console.log("[INFO] JSON RPC: getInfo")
    //     return await rpc.getInfo();
    // }

    // async getBlockchainInfo(): Promise<BlockchainInfoResult> {
    //     console.log("[INFO] JSON RPC: getBlockchainInfo")
    //     return await rpc.getBlockchainInfo();
    // }
}

// client.getMempoolInfo(new bchrpc.GetMempoolInfoRequest(), (error: grpc.ServiceError|null, resp: bchrpc.GetMempoolInfoResponse|null) => {
//     if (error) {
//         console.log("Error: " + error.code + ": " + error.message)
//         console.log(error)
//     } else {
//     var mempool = resp
//     console.log("\nGetMempoolInfo:")
//     console.log(mempool!.toObject())
//     }
// });

// // Get a raw tx from tx hash

// var hex = "fe58d09c218d6ea1a0d1ce726d1c5aa6e9c01a9e760aab621484aa21b1f673fb";
// var bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))).reverse();

// var getRawTransactionRequest = new bchrpc.GetRawTransactionRequest()
// getRawTransactionRequest.setHash(bytes)

// client.getRawTransaction(getRawTransactionRequest, function(error, resp) {
//     if (error) {
//         console.log("Error: " + error.code + ": " + error.message)
//         console.log(error)
//     } else {
//     var tx = resp
//     console.log("\nGetRawTransaction:")
//     console.log(Buffer.from(tx.getTransaction_asU8()).toString('hex'))
//     }
// });

// // Get deserialized tx from tx hash

// var getTransactionRequest = new bchrpc.GetTransactionRequest();
// getTransactionRequest.setHash(bytes);

// client.getTransaction(getTransactionRequest, function(error, resp) {
//     if (error) {
//         console.log("Error: " + error.code + ": " + error.message)
//         console.log(error)
//     } else {
//     var tx = resp
//     console.log("\nGetTransaction:")
//     console.log(tx.getTransaction()!.getInputsList()!.map(i => i.toObject()))
//     }
// });


// // Setup live transaction stream

// var transactionFilter = new bchrpc.TransactionFilter();
// transactionFilter.setAllTransactions(true);

// var subscribreTransactionsRequest = new bchrpc.SubscribeTransactionsRequest()
// subscribreTransactionsRequest.setIncludeMempool(true)
// subscribreTransactionsRequest.setSubscribe(transactionFilter)

// var stream = client.subscribeTransactions(subscribreTransactionsRequest)

// stream.on('data', function(message: bchrpc.TransactionNotification) {
//     var tx = message
//     console.log("\nSubscribeTransactions stream:")
//     console.log(Buffer.from(tx.getUnconfirmedTransaction()!.getTransaction()!.serializeBinary()).toString('hex'))
//     console.log(Buffer.from(tx.getUnconfirmedTransaction()!.getTransaction()!.getHash_asU8().reverse()).toString('hex'))
// });
// stream.on('status', function(status: any) {
//     console.log("\nSubscribeTransactions status:")
//     console.log(status.toObject())
// });
// stream.on('end', function(status: any) {
//     console.log("\nSubscribeTransactions end:")
//     console.log(status.toObject())
// });