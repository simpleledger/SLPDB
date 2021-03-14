import { Config } from "./config";
import { TxOutResult, BlockchainInfoResult, BlockHeaderResult, MempoolInfoResult } from "bitcoin-com-rest";
import { GrpcClient, BlockInfo, GetUnspentOutputResponse } from "grpc-bchrpc-node";
import { CacheMap } from "./cache";

const _rpcClient = require('bitcoin-rpc-promise-retry');
const connectionString = 'http://' + Config.rpc.user + ':' + Config.rpc.pass + '@' + Config.rpc.host + ':' + Config.rpc.port

let grpc: GrpcClient;
let rpc: any;
let rpc_retry: any;

export class RpcClient {
    static transactionCache = new CacheMap<string, Buffer>(500000);
    static useGrpc: boolean | undefined;
    constructor({ useGrpc }: { useGrpc?: boolean }) {
        if (useGrpc) {
            RpcClient.useGrpc = useGrpc;
            if (Boolean(Config.grpc.url) && Config.grpc.certPath) {
                grpc = new GrpcClient({ url: Config.grpc.url, rootCertPath: Config.grpc.certPath });
            } else {
                grpc = new GrpcClient({ url: Config.grpc.url });
            }
        } else {
            rpc = new _rpcClient(connectionString, { maxRetries: 0 });
            rpc_retry = new _rpcClient(connectionString, { maxRetries: Config.rpc.rpcMaxRetries, timeoutMs: Config.rpc.rpcTimeoutMs, retryDelayMs: Config.rpc.rpcRetryDelayMs });
        }
    }

    static loadTxnIntoCache(txid: string, txnBuf: Buffer) {
        RpcClient.transactionCache.set(txid, txnBuf);
    }

    static async getBlockCount(): Promise<number> {
        if (this.useGrpc) {
            console.log("[INFO] gRPC: getBlockchainInfo");
            return (await grpc.getBlockchainInfo()).getBestHeight();
        }
        console.log("[INFO] JSON RPC: getBlockCount")
        return await rpc_retry.getBlockCount();
    }

    static async getBlockchainInfo(): Promise<BlockchainInfoResult> {
        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getBlockchainInfo");
            let info = await grpc.getBlockchainInfo();
            return {
                chain: info.getBitcoinNet() ? 'test' : 'main',
                blocks: info.getBestHeight(),
                headers: 0,
                bestblockhash: Buffer.from(info.getBestBlockHash_asU8().reverse()).toString('hex'),
                difficulty: info.getDifficulty(),
                mediantime: info.getMedianTime(),
                verificationprogress: 0,
                chainwork: '',
                pruned: false,
                softforks: [],
                bip9_softforks: []
              }
        }
        console.log("[INFO] JSON RPC: getBlockchainInfo")
        return await rpc_retry.getBlockchainInfo();
    }

    static async getBlockHash(block_index: number, asBuffer=false): Promise<string|Buffer> {
        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getBlockInfo (for getBlockHash)");
            let hash = Buffer.from((await grpc.getBlockInfo({ index: block_index })).getInfo()!.getHash_asU8().reverse());
            if(asBuffer) {
                return hash;
            }
            return hash.toString('hex');
        }
        console.log("[INFO] JSON RPC: getBlockHash", block_index);
        let hash = await rpc.getBlockHash(block_index);
        if (asBuffer) {
            return Buffer.from(hash, 'hex');
        }
        return hash;
    }

    static async getRawBlock(hash: string): Promise<string> {
        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getRawBlock");
            return Buffer.from((await grpc.getRawBlock({ hash: hash, reversedHashOrder: true })).getBlock_asU8()).toString('hex')
        }
        return await rpc_retry.getBlock(hash, 0);
    }

    static async getBlockInfo({ hash, index }: { hash?: string, index?: number}): Promise<BlockHeaderResult> {
        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getBlockInfo");
            let blockinfo: BlockInfo;
            if (index) {
                blockinfo = (await grpc.getBlockInfo({ index: index })).getInfo()!;
            } else {
                blockinfo = (await grpc.getBlockInfo({ hash: hash, reversedHashOrder: true })).getInfo()!;
            }

            return {
                hash: Buffer.from(blockinfo.getHash_asU8().reverse()).toString('hex'),
                confirmations: blockinfo.getConfirmations(),
                height: blockinfo.getHeight(),
                version: blockinfo.getVersion(),
                versionHex: blockinfo.getVersion().toString(2),
                merkleroot: Buffer.from(blockinfo.getMerkleRoot_asU8().reverse()).toString('hex'),
                time: blockinfo.getTimestamp(),
                mediantime: blockinfo.getMedianTime(),
                nonce: blockinfo.getNonce(),
                difficulty: blockinfo.getDifficulty(),
                previousblockhash: Buffer.from(blockinfo.getPreviousBlock_asU8().reverse()).toString('hex'),
                nextblockhash: Buffer.from(blockinfo.getNextBlockHash_asU8().reverse()).toString('hex'),
                chainwork: '',
                bits: ''
              }
        }

        if (index) {
            console.log("[INFO] JSON RPC: getBlockInfo/getBlockHash", index);
            hash = await rpc.getBlockHash(index);
        } else if (!hash) {
            throw Error("No index or hash provided for block")
        }

        console.log("[INFO] JSON RPC: getBlockInfo/getBlockHeader", hash, true);
        return <BlockHeaderResult>await rpc.getBlockHeader(hash);
    }

    static async getRawMemPool(): Promise<string[]> {
        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getRawMemPool");
            return (await grpc.getRawMempool({ fullTransactions: false })).getTransactionDataList().map(t => Buffer.from(t.getTransactionHash_asU8().reverse()).toString('hex'))
        }
        console.log("[INFO] JSON RPC: getRawMemPool")
        return await rpc_retry.getRawMemPool();
    }

    static async getRawTransaction(hash: string, retryRpc=true): Promise<string> { 
        if (RpcClient.transactionCache.has(hash)) {
            console.log("[INFO] cache: getRawTransaction");
            return RpcClient.transactionCache.get(hash)!.toString('hex');
        }

        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getRawTransaction", hash);
            return Buffer.from((await grpc.getRawTransaction({ hash: hash, reversedHashOrder: true })).getTransaction_asU8()).toString('hex');
        }

        console.log("[INFO] JSON RPC: getRawTransaction", hash);
        if (retryRpc) {
            return await rpc_retry.getRawTransaction(hash);
        } else {
            return await rpc.getRawTransaction(hash);
        }
    }

    static async getTransactionBlockHash(hash: string): Promise<string> {
        if (RpcClient.useGrpc) {
            console.log("[INFO] gRPC: getTransaction", hash);
            let txn = await grpc.getTransaction({ hash: hash, reversedHashOrder: true });
            return Buffer.from(txn.getTransaction()!.getBlockHash_asU8().reverse()).toString('hex');
        }
        console.log("[INFO] JSON RPC: getRawTransaction", hash, 1);
        return (await rpc_retry.getRawTransaction(hash, 1)).blockhash;
    }

    static async getTxOut(hash: string, vout: number): Promise<TxOutResult|GetUnspentOutputResponse|null> {
        if (RpcClient.useGrpc){
            console.log("[INFO] gRPC: getTxOut", hash, vout);
            try {
                let utxo = (await grpc.getUnspentOutput({ hash: hash, vout: vout, reversedHashOrder: true, includeMempool: true }));
                return utxo;
            } catch(_) {
                return null
            }
        }
        console.log("[INFO] JSON RPC: getTxOut", hash, vout, true);
        return await rpc_retry.getTxOut(hash, vout, true);
    }

    static async getMempoolInfo(): Promise<MempoolInfoResult|{}> {
        if (RpcClient.useGrpc) {
            return {};
        }
        console.log("[INFO] JSON RPC: getMempoolInfo");
        return await rpc_retry.getMemPoolInfo();
    }

    // DO NOT USE, THIS IS DEPRECIATED ON SOME NODES
    // async getInfo(): Promise<NodeInfoResult> {
    //     console.log("[INFO] JSON RPC: getInfo")
    //     return await rpc.getInfo();
    // }
}
