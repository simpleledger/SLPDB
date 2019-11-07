import * as assert from "assert";
import { Slp, LocalValidator, TransactionHelpers, Utils, SlpAddressUtxoResult } from 'slpjs';
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

// connect to bitcoin regtest network JSON-RPC
const rpcClient = require('bitcoin-rpc-promise-retry');
const connectionStringNode1_miner = 'http://bitcoin:password@0.0.0.0:18443';  // (optional) connect to a miner's rpc on 18444 that is not connected to SLPDB
const rpcNode1_miner = new rpcClient(connectionStringNode1_miner, { maxRetries: 0 });

// setup the SLP validator
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
const slpdbTxnNotifications: TNATxn[] = [];
const slpdbBlockNotifications: { txns: { slp: TNATxnSlpDetails, txid: string }[], hash: string }[] = [];
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
let receiver: string;
let nonSlpUtxos: SlpAddressUtxoResult[];
let tokenId: string;
let blockHash: string;

describe("Token-Type-1", () => {

    step("setup the test's GENESIS txn", async () => {

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

        // this prevents: 'too-long-mempool-chain, too many unconfirmed ancestors [limit: 25] (code 64)'
        await rpcNode1_miner.generate(1);

        // put all the funds on the receiver's address
        receiver = await rpcNode1_miner.getNewAddress("0");
        await rpcNode1_miner.sendToAddress(receiver, 1, "", "", true);

        let unspent = await rpcNode1_miner.listUnspent(0);
        unspent = unspent.filter((txo: any) => txo.address === receiver);
        if (unspent.length === 0) throw Error("No unspent outputs.");
        unspent.map((txo: any) => txo.cashAddress = txo.address);
        unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
        await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));

        // validate and categorize unspent TXOs
        let utxos = await slp.processUtxosForSlpAbstract([unspent[0]], validator);
        nonSlpUtxos = utxos.nonSlpUtxos;

        assert.equal(nonSlpUtxos.length > 0, true);
    });

    step("produces ZMQ output for the transaction", async () => {
        // create and broadcast SLP genesis transaction
        receiver = Utils.toSlpAddress(receiver);
        let genesisTxnHex = txnHelpers.simpleTokenGenesis(
                                "unit-test-1", "ut1", new BigNumber(10), null, null, 
                                1, receiver, receiver, receiver, nonSlpUtxos);

        tokenId = await rpcNode1_miner.sendRawTransaction(genesisTxnHex, true);

        // give slpdb time to process
        while(slpdbTxnNotifications.length === 0) {
            await sleep(50);
        }

        // check that SLPDB made proper outgoing ZMQ messages for 
        assert.equal(slpdbTxnNotifications.length, 1);
        assert.equal(slpdbTxnNotifications[0]!.slp!.valid, true);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.name, "unit-test-1");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.symbol, "ut1");
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.tokenIdHex, tokenId);
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].address, receiver);
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!["$numberDecimal"], "1");
        assert.equal(slpdbTxnNotifications[0]!.blk === undefined, true);
        assert.equal(typeof slpdbTxnNotifications[0]!.in, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.out, "object");
        assert.equal(typeof slpdbTxnNotifications[0]!.tx, "object");
    });

    step("stores in unconfirmed collection", async () => {
        let txn = await db.unconfirmedFetch(tokenId);
        let unconfirmed = await db.db.collection("unconfirmed").find({}).toArray();
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-1");
        assert.equal(txn!.slp!.detail!.symbol, "ut1");
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!["$numberDecimal"], "1");        
        assert.equal(txn!.slp!.detail!.tokenIdHex, txn!.tx.h);
        assert.equal(unconfirmed.length, 1);
    });

    step("stores in tokens collection (before block)", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, tokenId + ":2");
        assert.equal(t!.tokenStats!.block_created, null);
        assert.equal(t!.tokenStats!.block_last_active_mint, null);
        assert.equal(t!.tokenStats!.block_last_active_send, null);
        assert.equal(t!.tokenStats!.qty_token_burned.toString(), "0");
        assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), "1");
        assert.equal(t!.tokenStats!.qty_token_minted.toString(), "1");
        assert.equal(t!.tokenStats!.minting_baton_status, TokenBatonStatus.ALIVE);
    });

    step("stores in graphs collection (before block)", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": tokenId });
        assert.equal(g!.graphTxn.txid, tokenId);
        assert.equal(g!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(g!.graphTxn.blockHash, null);
    });

    step("produces ZMQ output at block", async () => {
        blockHash = (await rpcNode1_miner.generate(1))[0];
        while(slpdbBlockNotifications.length === 0) {
            await sleep(50);
        }
        assert.equal(slpdbBlockNotifications.length, 1);
        assert.equal(slpdbBlockNotifications[0].txns.length, 1);
        assert.equal(slpdbBlockNotifications[0].txns[0]!.txid, tokenId);
        assert.equal(slpdbBlockNotifications[0].txns[0]!.slp.detail!.tokenIdHex, tokenId);
        assert.equal(slpdbBlockNotifications[0].txns[0]!.slp.detail!.name, "unit-test-1");
        assert.equal(slpdbBlockNotifications[0].txns[0]!.slp.detail!.symbol, "ut1");
        // @ts-ignore
        assert.equal(slpdbBlockNotifications[0]!.txns[0]!.slp!.detail!.outputs![0].amount!, "1");  // this type is not consistent with txn notification
        // TODO: There is not block hash with block zmq notification!
        // assert.equal(typeof slpdbBlockNotifications[0]!.hash, "string");
        // assert.equal(slpdbBlockNotifications[0]!.hash.length, 64);
    });

    step("stores in confirmed collection", async () => {
        let txn = await db.confirmedFetch(tokenId);
        assert.equal(txn!.slp!.valid, true);
        assert.equal(txn!.slp!.detail!.name, "unit-test-1");
        assert.equal(txn!.slp!.detail!.symbol, "ut1");
        // @ts-ignore
        assert.equal(slpdbTxnNotifications[0]!.slp!.detail!.outputs![0].amount!["$numberDecimal"], "1");        
        assert.equal(txn!.slp!.detail!.tokenIdHex, txn!.tx.h);
    });

    step("stores in tokens collection (after block)", async () => {
        let t: TokenDBObject | null = await db.tokenFetch(tokenId);
        while(!t || t!.tokenStats!.block_created === null) {
            await sleep(50);
            t = await db.tokenFetch(tokenId);
        }
        assert.equal(typeof t!.tokenDetails.timestamp, "string");
        assert.equal(t!.tokenDetails.timestamp_unix! > 0, true);
        assert.equal(t!.tokenDetails.tokenIdHex, tokenId);
        assert.equal(t!.mintBatonUtxo, tokenId + ":2");
        assert.equal(t!.tokenStats!.block_created! > 0, true);
        assert.equal(t!.tokenStats!.block_last_active_mint, null);
        assert.equal(t!.tokenStats!.block_last_active_send, null);
        assert.equal(t!.tokenStats!.qty_token_burned.toString() === "0", true);
        assert.equal(t!.tokenStats!.qty_token_circulating_supply.toString(), "1");
        assert.equal(t!.tokenStats!.qty_token_minted.toString(), "1");
        assert.equal(t!.tokenStats!.minting_baton_status, TokenBatonStatus.ALIVE);
    });

    step("updates graphs collection (after block)", async () => {
        let g: GraphTxnDbo | null = await db.db.collection("graphs").findOne({ "graphTxn.txid": tokenId });
        assert.equal(g!.graphTxn.txid, tokenId);
        assert.equal(g!.tokenDetails.tokenIdHex, tokenId);
        while(!g || g!.graphTxn.blockHash === null) {
            await sleep(50);
            g = await db.db.collection("graphs").findOne({ "graphTxn.txid": tokenId });
        }
        assert.equal(g!.graphTxn.blockHash.toString('hex'), blockHash);
    });

    step("stores in addresses collection", async () => {
        let a: AddressBalancesDbo[] = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        while(a.length === 0) {
            await sleep(50);
            a = await db.db.collection("addresses").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        }
        assert.equal(a.length, 1);
        assert.equal(a[0].address, receiver);
        assert.equal(a[0].satoshis_balance, 546);
        // @ts-ignore
        assert.equal(a[0].token_balance.toString(), "1");
    });

    step("stores in utxos collection", async () => {
        let x: UtxoDbo[] = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        while(x.length === 0) {
            await sleep(50);
            x = await db.db.collection("utxos").find({ "tokenDetails.tokenIdHex": tokenId }).toArray();
        }
        assert.equal(x.length, 1);
        assert.equal(x[0].address, receiver);
        assert.equal(x[0].bchSatoshis, 546);
        // @ts-ignore
        assert.equal(x[0].slpAmount.toString(), "1");
    });

    // step("setup a SEND transaction", async () => {
    //     let unspent = await rpcNode1_miner.listUnspent(0);
    //     unspent = unspent.filter((txo: any) => txo.address === receiver);
    //     if (unspent.length === 0) throw Error("No unspent outputs.");
    //     unspent.map((txo: any) => txo.cashAddress = txo.address);
    //     unspent.map((txo: any) => txo.satoshis = txo.amount*10**8);
    //     await Promise.all(unspent.map(async (txo: any) => txo.wif = await rpcNode1_miner.dumpPrivKey(txo.address)));
    // });
});
