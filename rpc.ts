import { Config } from "./config";
import { VerboseRawTransactionResult, TxOutResult, NodeInfoResult, BlockchainInfoResult, BlockDetailsResult } from "bitcoin-com-rest";
import GrpcClient from "./grpc";

const _rpcClient = require('bitcoin-rpc-promise');
const connectionString = 'http://' + Config.rpc.user + ':' + Config.rpc.pass + '@' + Config.rpc.host + ':' + Config.rpc.port
const rpc = new _rpcClient(connectionString);

const gprc = new GrpcClient()

export class RpcClient {
    useGrpc: any;

    constructor(useGrpc?: boolean) {
        if(useGrpc) {
            this.useGrpc = useGrpc;
        }
        this.useGrpc = true;
    }

    async getRawTransaction(hash: string): Promise<string> { 

        if(this.useGrpc) {
            console.log("[INFO] gRPC: getRawTransaction", hash);
            return await gprc.getRawTransaction(hash);
        } 
        // else if(this.useGrpc) { }

        console.log("[INFO] JSON RPC: getRawTransaction", hash);
        return await rpc.getRawTransaction(hash);
    }

    async getTransaction(hash: string): Promise<VerboseRawTransactionResult> {
        if(this.useGrpc) {
            console.log("[INFO] gRPC: getTransaction", hash);
            return await gprc.getTransaction(hash);
        }

        console.log("[INFO] JSON RPC: getRawTransaction", hash, 1);
        return await rpc.getRawTransaction(hash, 1);
    }

    async getBlockHash(block_index: number): Promise<string> {
        console.log("[INFO] JSON RPC: getBlockHash", block_index);
        return await rpc.getBlockHash(block_index);
    }

    async getBlock(hash: string, verbose?: boolean): Promise<string|BlockDetailsResult>{
        console.log("[INFO] JSON RPC: getBlock", hash, verbose);
        if(verbose === false)
            return await rpc.getBlock(hash, 0);
        return <BlockDetailsResult>await rpc.getBlock(hash);
    }

    async getBlockCount(): Promise<number> {
        console.log("[INFO] JSON RPC: getBlockCount")
        return await rpc.getBlockCount();
    }

    async getRawMemPool(): Promise<string[]> {
        console.log("[INFO] JSON RPC: getRawMemPool")
        return await rpc.getRawMemPool();
    }

    async getTxOut(hash: string, vout: number, includemempool: boolean): Promise<TxOutResult|null> {
        console.log("[INFO] JSON RPC: getTxOut", hash, vout, includemempool);
        return await rpc.getTxOut(hash, vout, includemempool);
    }

    // DO NOT USE, THIS IS DEPRECIATED ON SOME NODES
    // async getInfo(): Promise<NodeInfoResult> {
    //     console.log("[INFO] JSON RPC: getInfo")
    //     return await rpc.getInfo();
    // }

    async getBlockchainInfo(): Promise<BlockchainInfoResult> {
        console.log("[INFO] JSON RPC: getBlockchainInfo")
        return await rpc.getBlockchainInfo();
    }
}
