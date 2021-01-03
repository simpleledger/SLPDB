import { SlpTransactionType, SlpTransactionDetails } from 'slpjs';
import { Decimal128 } from 'mongodb';
import BigNumber from 'bignumber.js';

export type cashAddr = string;

export interface GraphTxn {
    details: SlpTransactionDetails;
    outputs: GraphTxnOutput[];
    inputs: GraphTxnInput[];
    prevPruneHeight: number|null;
    blockHash: Buffer|null;
}

export interface GraphTxnOutput {
    address: string|null;
    vout: number;
    bchSatoshis: number|null;
    slpAmount: BigNumber;
    spendTxid: string | null;
    status: TokenUtxoStatus|BatonUtxoStatus;
    invalidReason: string | null;
 }

export interface GraphTxnInput {
    txid: string;
    vout: number;
    slpAmount: BigNumber;
    address: string;
    bchSatoshis: number;
}

export interface TokenStatsDbo {
    block_created: number|null;
    approx_txns_since_genesis: number|null;
}

export interface TokenDBObject {
    schema_version: number;
    tokenDetails: SlpTransactionDetailsDbo;
    tokenStats: TokenStatsDbo;
    mintBatonUtxo: string;
    mintBatonStatus: TokenBatonStatus;
    lastUpdatedBlock: number;
    nftParentId?: string;
    _pruningState: TokenPruneStateDbo;
}

export interface TokenPruneStateDbo {
    pruneHeight: number;
    sendCount: number;
    mintCount: number;
}

export interface GraphTxnDbo {
    tokenDetails: {
        tokenIdHex: string;
        nftGroupIdHex?: string;
    };
    graphTxn: GraphTxnDetailsDbo;
}

export interface SlpTransactionDetailsDbo {
    transactionType: SlpTransactionType;
    tokenIdHex: string;
    versionType: number;
    timestamp: string | null;
    timestamp_unix: number | null;
    symbol: string;
    name: string;
    documentUri: string;
    documentSha256Hex: string | null;
    decimals: number;
    containsBaton: boolean;
    batonVout: number | null;
    genesisOrMintQuantity: Decimal128 | null;
    sendOutputs: Decimal128[] | null;
}

export interface GraphTxnDetailsDbo {
    txid: string;
    details: SlpTransactionDetailsDbo;
    outputs: GraphTxnOutputDbo[];
    inputs: GraphTxnInputDbo[];
    _blockHash: Buffer | null;
    _pruneHeight: number | null;
}

export interface GraphTxnOutputDbo {
    address: string;
    vout: number;
    bchSatoshis: number;
    slpAmount: Decimal128;
    spendTxid: string | null;
    status: TokenUtxoStatus | BatonUtxoStatus;
    invalidReason: string | null;
}
export interface GraphTxnInputDbo {
    txid: string;
    vout: number;
    slpAmount: Decimal128;
    address: string;
    bchSatoshis: number;
}

export enum TokenUtxoStatus {
    "UNSPENT" = "UNSPENT", 
    "SPENT_SAME_TOKEN" = "SPENT_SAME_TOKEN",
    "SPENT_WRONG_TOKEN" = "SPENT_WRONG_TOKEN",
    "SPENT_NOT_IN_SEND" = "SPENT_NOT_IN_SEND",
    "SPENT_INVALID_SLP" = "SPENT_INVALID_SLP",
    "MISSING_BCH_VOUT" = "MISSING_BCH_VOUT",
    "EXCESS_INPUT_BURNED" = "EXCESS_INPUT_BURNED",
}

export enum BatonUtxoStatus {
    "BATON_UNSPENT" = "BATON_UNSPENT", 
    "BATON_SPENT_IN_MINT" = "BATON_SPENT_IN_MINT",
    "BATON_SPENT_NOT_IN_MINT" = "BATON_SPENT_NOT_IN_MINT", 
    "BATON_SPENT_INVALID_SLP" = "BATON_SPENT_INVALID_SLP",
    "BATON_MISSING_BCH_VOUT" = "BATON_MISSING_BCH_VOUT"
}

export enum TokenBatonStatus {
    "NEVER_CREATED" = "NEVER_CREATED",
    "ALIVE" = "ALIVE",
    "DEAD_BURNED" = "DEAD_BURNED",
    "DEAD_ENDED" = "DEAD_ENDED",
    "UNKNOWN" = "UNKNOWN"
}
