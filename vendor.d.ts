import { VerboseRawTransactionResult } from 'bitcoin-com-rest'
import { BITBOX } from 'bitbox-sdk';
import { BlockchainInfoResult, TxOutResult } from 'bitcoin-com-rest';
import { NodeInfoResult } from 'bitcoin-com-rest';
import { BlockDetailsResult } from 'bitcoin-com-rest';

export module BitcoinRpc {
    export interface RpcClient {
        getBlockHash(block_index: number): Promise<string>;
        getBlock(hash: string): Promise<BlockDetailsResult>;
        getBlock(hash: string, verbose: boolean): Promise<string>;
        getBlockCount(): Promise<number>;
        getRawTransaction(hash: string): Promise<string>;
        getRawTransaction(hash: string, verbose: number): Promise<VerboseRawTransactionResult>;
        getRawMempool(): Promise<string[]>;
        getTxOut(hash: string, vout: number, includemempool: boolean): Promise<TxOutResult|null>;
        getInfo(): Promise<NodeInfoResult>;
        getBlockchainInfo(): Promise<BlockchainInfoResult>;
    }
}

export declare module Bitcore {
    export interface TxnInput {
        script: Script;
        _scriptBuffer: Buffer;
        prevTxId: Buffer;
        outputIndex: number;
        sequenceNumber: number;
    }

    export interface Script {
        fromBuffer(buffer: Buffer): Script;
        toBuffer(): Buffer;
        toAddress(network: any): Address;
        fromAddress(address: Address): Script;
        fromString(hex: string): Script;
        fromASM(asm: string): string;
        toASM(): string;
        fromHex(hex: string): string
        toHex(): string;
        chunks: Chunk[];
    }

    export interface Chunk {
        buf: Buffer;
        len: number;
        opcodenum: number;
    }
    
    export interface TxnOutput {
        _scriptBuffer: Buffer;
        script: Script;
        satoshis: number;
    }
    
    export interface Transaction {
        inputs: TxnInput[];
        outputs: TxnOutput[];
        toObject(): any;
        serialize(unsafe?: boolean): string
        hash: string;
        id: string;
    }

    // export interface Networks {
    //     livenet: any;
    //     testnet: any;
    // }

    export interface Address {
        toString(format: string): string;
    }
}