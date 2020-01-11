import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult, SlpTransactionType } from 'slpjs';
import * as zmq from 'zeromq';
import { BITBOX } from 'bitbox-sdk';
import BigNumber from 'bignumber.js';
import { step } from 'mocha-steps';

import { Config } from "../config";
import { Db } from '../db';
import { TNATxn, TNATxnSlpDetails } from "../tna";
import { TokenBatonStatus } from "../interfaces";
import { GraphTxnDbo, AddressBalancesDbo, UtxoDbo, TokenDBObject } from "../interfaces";

const bitbox = new BITBOX();
const slp = new Slp(bitbox);
const txnHelpers = new TransactionHelpers(slp);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TOKEN_DECIMALS = 1;
const TOKEN_GENESIS_QTY = 100;
const TOKEN_SEND_QTY = 1;

// connect to bitcoin regtest network JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = 'http://bitcoin:password@0.0.0.0:18443';  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });

// setup a new local SLP validator instance
const validator = new LocalValidator(bitbox, async (txids) => { 
    let txn;
    try {
        txn = <string>await rpcNode1_miner.getRawTransaction(txids[0]);
    } catch(err) {
        throw Error(`[ERROR] Could not get transaction ${txids[0]} in local validator: ${err}`)
    }
    return [ txn ];
}, console);

// connect to SLPDB ZMQ notifications
let slpdbTxnNotifications: TNATxn[] = [];
let slpdbBlockNotifications: { txns: { slp: TNATxnSlpDetails, txid: string }[], hash: string }[] = [];
const sock: any = zmq.socket('sub');
sock.connect('tcp://0.0.0.0:27339');
sock.subscribe('mempool');
sock.subscribe('block');
sock.on('message', async function(topic: string, message: Buffer) {
    if (topic.toString() === 'mempool') {
        let obj = JSON.parse(message.toString('utf8'));
        slpdbTxnNotifications.unshift(obj);
    } else if (topic.toString() === 'block') {
        let obj = JSON.parse(message.toString('utf8'));
        slpdbBlockNotifications.unshift(obj);    
    }
});

// connect to the regtest mongoDB
let db = new Db({ dbUrl: "mongodb://0.0.0.0:26017", dbName: "slpdb_test", config: Config.db });

// produced and shared between tests.
let receiverRegtest: string;
let receiverSlptest: string; // this is same address as receiverRegtest, converted to slptest format
let txnInputs: SlpAddressUtxoResult[];
let tokenId: string;
let sendTxid: string;
let lastBlockHash: string;
let lastBlockIndex: number;
let genesisBlockIndex: number;

describe("6-Burn-with-invalid-txn", () => {

    step("Initial setup for all tests", async () => {
        // TODO: burn any existing wallet funds, in order to prevent "Transaction too large".

        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);

        // (optional) connect miner node to a full node that is connected to slpdb
        // try {
        //     await rpcNode1_miner.addNode("bitcoin2", "onetry");
        // } catch(err) { }
        
        // make sure we have coins to use in tests
        let balance = await rpcNode1_miner.getBalance();
        while (balance < 1) {
            await rpcNode1_miner.generate(1);
            balance = await rpcNode1_miner.getBalance();
        }

        // put all the funds on the receiver's address
        receiverRegtest = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiverRegtest, 1, "", "", true);
    });

    step("GENESIS: setup for the txn tests", async () => {
        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        txnInputs = utxos.nonSlpUtxos;

        assert.equal(txnInputs.length > 0, true);
    });

    step("GENESIS: produces ZMQ output for the transaction", async () => {
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        // create and broadcast SLP genesis transaction
        receiverSlptest = Utils.toSlpAddress(receiverRegtest);
        let genesisTxnHex = txnHelpers.simpleTokenGenesis(
                                "unit-test-6", "ut6", new BigNumber(TOKEN_GENESIS_QTY).times(10**TOKEN_DECIMALS), null, null, 
                                TOKEN_DECIMALS, receiverSlptest, receiverSlptest, receiverSlptest, txnInputs);

        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);

        // give slpdb time to process
        while(slpdbTxnNotifications.length === 0) {
            await sleep(50);
        }

        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.equal(slpdbTxnNotifications.length, 1);
        assert.equal(slpdbTxnNotifications[0]!.slp!.valid, true);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.name, "unit-test-6");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.symbol, "ut6");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.tokenIdHex, tokenId);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.transactionType, SlpTransactionType.GENESIS);
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!["$numberDecimal"], TOKEN_GENESIS_QTY.toFixed());
        assert.equal(slpdbTxnNotifications[0]!.blk === undefined, true);
        assert.equal(typeof slpdbTxnNotifications[0]!.in, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.out, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.tx, "object");
    });

    step("GENESIS: stores in confirmed collection (after block)", async () => {
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        let txn = await db.confirmedFetch(tokenId);
        while(!txn) {
            await sleep(50);
            txn = await db.confirmedFetch(tokenId);
        }
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        genesisBlockIndex = lastBlockIndex;
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-6");
        assert.equal(txn!.slp!.detail!.symbol, "ut6");
        // @ts-ignore
        assert.equal(txn!.slp!.detail!.outputs![0].amount!.toString(), TOKEN_GENESIS_QTY.toFixed());        
        assert.equal(txn!.slp!.detail!.tokenIdHex, txn!.tx.h);
    });

    step("SEND: setup for the txn tests", async () => {
        // get current address UTXOs
        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiverRegtest);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // process raw UTXOs
        let utxos = await slp.processUtxosForSlpAbstract(unspent, validator);

        // select the inputs for transaction
        txnInputs = [ ...utxos.nonSlpUtxos, ...utxos.slpTokenUtxos[tokenId] ];

        assert.equal(txnInputs.length > 1, true);
    });

    step("SEND: produces ZMQ output for the transaction", async () => {
        // clear ZMQ cache
        slpdbTxnNotifications = [];
        slpdbBlockNotifications = [];

        // create a SEND Transaction
        let sendTxnHex = txnHelpers.simpleTokenSend(tokenId, new BigNumber(TOKEN_SEND_QTY).times(10**TOKEN_DECIMALS), txnInputs, receiverSlptest, receiverSlptest);

        sendTxid = await rpcNode1_miner.sendRawTransaction(sendTxnHex, true);

        while(slpdbTxnNotifications.length === 0) {
            await sleep(50);
        }

        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.equal(slpdbTxnNotifications.length, 1);
        assert.equal(slpdbTxnNotifications[0]!.slp!.valid, true);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.name, "unit-test-6");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.symbol, "ut6");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.tokenIdHex, tokenId);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].address, receiverSlptest);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.transactionType, SlpTransactionType.SEND);
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!["$numberDecimal"], (new BigNumber(TOKEN_SEND_QTY)).toFixed());
        let change = (new BigNumber(TOKEN_GENESIS_QTY)).minus(TOKEN_SEND_QTY).toFixed();
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![1].amount!["$numberDecimal"], change);
        assert.equal(slpdbTxnNotifications[0]!.blk === undefined, true);
        assert.equal(typeof slpdbTxnNotifications[0]!.in, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.out, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.tx, "object");
    });

    step("SEND: stores in confirmed collection (after block)", async () => {
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        let txn = await db.confirmedFetch(sendTxid);
        while(!txn) {
            await sleep(50);
            txn = await db.confirmedFetch(sendTxid);
        }
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-6");
        assert.equal(txn!.slp!.detail!.symbol, "ut6");
        // @ts-ignore
        assert.equal(txn!.slp!.detail!.outputs![0].amount!.toString(), TOKEN_SEND_QTY.toFixed());    
        // @ts-ignore
        assert.equal(txn!.slp!.detail!.outputs![1].amount!.toString(), (TOKEN_GENESIS_QTY-TOKEN_SEND_QTY).toFixed());     
        assert.equal(txn!.slp!.detail!.tokenIdHex, tokenId);
        assert.equal(txn!.tx.h, sendTxid);
    });

    step("BURN: make an invalid SLP transaction that burns all SLP coins", async () => {
        let balance = await rpcNode1_miner.getBalance();
        await rpcNode1_miner.sendToAddress(receiverRegtest, balance, "", "", true);
        lastBlockHash = (await rpcNode1_miner.generate(1))[0];
        lastBlockIndex = (await rpcNode1_miner.getBlock(lastBlockHash, true)).height;
    });

    step("BURN: check that tokens collection records correct circulating supply", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while(!t ||
              t!.tokenStats!.block_created === null ||
              //t!.tokenStats!.qty_token_circulating_supply.toString() !== "0" ||
              t!.mintBatonUtxo !== ""
        ) {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.equal(typeof t!.tokenDetails.timestamp, "string");
        assert.equal(t!.tokenDetails.timestamp_unix! > 0, true);
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, "");
        assert.equal(t!.tokenStats!.block_created!, genesisBlockIndex);
        assert.equal(t!.tokenStats!.block_last_active_mint, null);
        assert.equal(t!.tokenStats!.block_last_active_send, lastBlockIndex-1);
        // assert.equal(t!.tokenStats!.qty_token_burned.toString() === "100", true);
        // assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), "0");
        // assert.equal(t!.tokenStats!.qty_token_minted.toString(), TOKEN_GENESIS_QTY.toFixed());
        assert.equal(t!.tokenStats!.minting_baton_status, TokenBatonStatus.DEAD_BURNED);
        assert.equal(t!.tokenStats!.qty_valid_token_utxos, 0);
        assert.equal(t!.tokenStats!.qty_satoshis_locked_up, 0);
        assert.equal(t!.tokenStats!.qty_valid_token_addresses, 0);
    });

    step("Cleanup after tests", async () => {
        // generate block to clear the mempool (may be dirty from previous tests)
        await rpcNode1_miner.generate(1);
        sock.disconnect('tcp://0.0.0.0:27339');
    });
});
