import { runInThisContext } from "vm";
import { VerboseRawTransaction } from 'bitbox-sdk/lib/RawTransactions'

export module BitcoinRpc {
    export interface RpcClient {
        getBlockHash(block_index: number): Promise<string>;
        getBlock(hash: string): Promise<RpcBlockInfo>;
        getBlock(hash: string, verbose: boolean): Promise<string>;
        getBlockCount(): Promise<number>;
        getRawTransaction(hash: string): Promise<string>;
        getRawTransaction(hash: string, verbose: number): Promise<VerboseRawTransaction>;
        getRawMempool(): Promise<string[]>;
        getTxOut(hash: string, vout: number, includemempool: boolean): Promise<VerboseTxOut|null>;
    }
    
    export interface VerboseTxOut {
        bestblock: string,      //  (string) the block hash
        confirmations: number,  //  (numeric) The number of confirmations
        value: number,          //  (numeric) The transaction value in BCH
        scriptPubKey: {         //  (json object)
            asm: string,        //  (string) 
            hex: string,        //  (string) 
            reqSigs: number,    //  (numeric) Number of required signatures
            type: string,       //  (string) The type, eg pubkeyhash
            addresses: string[] //  (array of string) array of bitcoin addresses
        },
        version: number,        //  (numeric) The version
        coinbase: boolean       //  (boolean) Coinbase or not
    }

    export interface RpcBlockInfo {
        hash: string;
        confirmations: number;
        size: number;
        height: number;
        version: number;
        versionHex: string;
        merkleroot: string;
        tx: string[];
        time: string;
        mediantime: number;
        nonce: number;
        bits: string;
        difficulty: number;
        chainwork: string;
        nextblockhash: string;
        previousblockhash: string;
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

    export interface Networks {
        livenet: any;
    }

    export interface Address {
        toString(format: string): string;
    }
}

export interface SlpTransaction {

}