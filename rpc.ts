import { Config } from "./config";
import { TxOutResult, BlockchainInfoResult, BlockHeaderResult } from "bitcoin-com-rest";
import { GrpcClient, BlockInfo, GetUnspentOutputResponse } from "grpc-bchrpc-node";

const _rpcClient = require('bitcoin-rpc-promise');
const connectionString = 'http://' + Config.rpc.user + ':' + Config.rpc.pass + '@' + Config.rpc.host + ':' + Config.rpc.port

let grpc: GrpcClient;
let rpc: any;

export class RpcClient {
    useGrpc: boolean | undefined;
    constructor({ useGrpc }: { useGrpc?: boolean }) {
        if(useGrpc) {
            this.useGrpc = useGrpc;
                if(Boolean(Config.grpc.url) && Config.grpc.certPath)
                    grpc = new GrpcClient({ url: Config.grpc.url, rootCertPath: Config.grpc.certPath })
                else
                    grpc = new GrpcClient({ url: Config.grpc.url })
        } else {
            rpc = new _rpcClient(connectionString);
        }
    }

    async getBlockCount(): Promise<number> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getBlockchainInfo");
            return (await grpc.getBlockchainInfo()).getBestHeight();
        }
        console.log("[INFO] JSON RPC: getBlockCount")
        return await rpc.getBlockCount();
    }

    async getBlockchainInfo(): Promise<BlockchainInfoResult> {
        if(this.useGrpc) {
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
        return await rpc.getBlockchainInfo();
    }

    async getBlockHash(block_index: number): Promise<string> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getBlockInfo (for getBlockHash)");
            return Buffer.from((await grpc.getBlockInfo({ index: block_index })).getInfo()!.getHash_asU8().reverse()).toString('hex');
        }
        console.log("[INFO] JSON RPC: getBlockHash", block_index);
        return await rpc.getBlockHash(block_index);
    }

    async getRawBlock(hash: string): Promise<string> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getRawBlock");
            return Buffer.from((await grpc.getRawBlock({ hash: hash, reverseOrder: true })).getBlock_asU8()).toString('hex')
        }
        return await rpc.getBlock(hash, 0);
    }

    async getBlockInfo({ hash, index }: { hash?: string, index?: number}): Promise<BlockHeaderResult> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getBlockInfo");
            let blockinfo: BlockInfo;
            if(index)
                blockinfo = (await grpc.getBlockInfo({ index: index })).getInfo()!;
            else
                blockinfo = (await grpc.getBlockInfo({ hash: hash, reverseOrder: true })).getInfo()!;
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

        if(index) {
            console.log("[INFO] JSON RPC: getBlockInfo/getBlockHash", index);
            hash = await rpc.getBlockHash(index);
        }
        else if(!hash)
            throw Error("No index or hash provided for block")

        console.log("[INFO] JSON RPC: getBlockInfo/getBlockHeader", hash, true);
        return <BlockHeaderResult>await rpc.getBlockHeader(hash);
    }

    async getRawMemPool(): Promise<string[]> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getRawMemPool");
            return (await grpc.getRawMempool()).getTransactionDataList().map(t => Buffer.from(t.getTransactionHash_asU8().reverse()).toString('hex'))
        }
        console.log("[INFO] JSON RPC: getRawMemPool")
        return await rpc.getRawMemPool();
    }

    async getRawTransaction(hash: string): Promise<string> { 
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getRawTransaction", hash);
            return Buffer.from((await grpc.getRawTransaction({ hash: hash, reverseOrder: true })).getTransaction_asU8()).toString('hex');
        } 
        console.log("[INFO] JSON RPC: getRawTransaction", hash);
        return await rpc.getRawTransaction(hash);
    }

    async getTransactionBlockHash(hash: string): Promise<string> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getTransaction", hash);
            let txn = await grpc.getTransaction({ hash: hash, reverseOrder: true });
            return Buffer.from(txn.getTransaction()!.getBlockHash_asU8().reverse()).toString('hex');
        }
        console.log("[INFO] JSON RPC: getRawTransaction", hash, 1);
        return await rpc.getRawTransaction(hash, 1).blockhash;
    }

    async getTxOut(hash: string, vout: number): Promise<TxOutResult|GetUnspentOutputResponse|null> {
        if(this.useGrpc){
            console.log("[INFO] gRPC: getTxOut", hash, vout);
            try {
                let utxo = (await grpc.getUnspentTransaction({ hash: hash, vout: vout, reverseOrder: true, includeMempool: true }));
                return utxo;
            } catch(_) {
                return null
            }
        }
        console.log("[INFO] JSON RPC: getTxOut", hash, vout, true);
        return await rpc.getTxOut(hash, vout, true);
    }

    // DO NOT USE, THIS IS DEPRECIATED ON SOME NODES
    // async getInfo(): Promise<NodeInfoResult> {
    //     console.log("[INFO] JSON RPC: getInfo")
    //     return await rpc.getInfo();
    // }
}
