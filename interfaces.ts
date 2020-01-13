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
    address: string;
    vout: number;
    bchSatoshis: number;
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
    block_last_active_send: number|null;
    block_last_active_mint: number|null;
    qty_valid_txns_since_genesis: number|null;
    qty_valid_token_utxos: number|null;
    qty_valid_token_addresses: number|null;
    qty_token_minted: Decimal128;
    qty_token_burned: Decimal128|null;
    qty_token_circulating_supply: Decimal128|null;
    qty_satoshis_locked_up: number|null;
}

export interface TokenDBObject {
    schema_version: number;
    tokenDetails: SlpTransactionDetailsDbo;
    tokenStats: TokenStatsDbo;
    pruningState: TokenPruneStateDbo;
    mintBatonUtxo: string;
    mintBatonStatus: TokenBatonStatus;
    lastUpdatedBlock: number;
    nftParentId?: string;
}

export interface TokenPruneStateDbo {
    sendCount: number;
    mintCount: number;
    mintQuantity: Decimal128;
    //validBurnQuantity: Decimal128;
}

export interface GraphTxnDbo {
    tokenDetails: {
        tokenIdHex: string;
    };
    graphTxn: GraphTxnDetailsDbo;
}

export interface UtxoDbo {
    tokenDetails: {
        tokenIdHex: string;
    };
    utxo: string;
    txid: string;
    vout: number;
    address: string;
    bchSatoshis: number;
    slpAmount: Decimal128;
    utxosChecksum: Buffer;
}

export interface AddressBalancesDbo {
    tokenDetails: {
        tokenIdHex: string;
    };
    address: cashAddr;
    satoshis_balance: number;
    token_balance: Decimal128;
    //utxosChecksum: Buffer;
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
    blockHash: Buffer | null;
    pruneHeight: number | null;
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
    bchSatoshis: number; // temporarily allow undefined
}

export enum TokenUtxoStatus {
    "UNSPENT" = "UNSPENT", 
    "SPENT_SAME_TOKEN" = "SPENT_SAME_TOKEN",
    "SPENT_WRONG_TOKEN" = "SPENT_WRONG_TOKEN",
    "SPENT_NOT_IN_SEND" = "SPENT_NOT_IN_SEND",
    "SPENT_NON_SLP" = "SPENT_NON_SLP",
    "SPENT_INVALID_SLP" = "SPENT_INVALID_SLP",
    "MISSING_BCH_VOUT" = "MISSING_BCH_VOUT",
    "EXCESS_INPUT_BURNED" = "EXCESS_INPUT_BURNED",
    //"UNKNOWN_UNTIL_BLOCK_SYNC" = "UNKNOWN_UNTIL_BLOCK_SYNC"  // may resolve to anything
}

export enum BatonUtxoStatus {
    "BATON_UNSPENT" = "BATON_UNSPENT", 
    "BATON_SPENT_IN_MINT" = "BATON_SPENT_IN_MINT",
    "BATON_SPENT_NOT_IN_MINT" = "BATON_SPENT_NOT_IN_MINT", 
    "BATON_SPENT_NON_SLP" = "BATON_SPENT_NON_SLP",
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
