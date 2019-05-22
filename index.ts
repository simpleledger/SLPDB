import * as dotenv from 'dotenv';
dotenv.config()

import { Config } from './config';
import { Info, ChainSyncCheckpoint } from './info';
import { Bit } from './bit';
import { Db } from './db';
import { SlpGraphManager } from './SlpGraphManager';
import { BitcoinRpc } from './vendor';

const RpcClient = require('bitcoin-rpc-promise');
const connectionString = 'http://'+ Config.rpc.user+':'+Config.rpc.pass+'@'+Config.rpc.host+':'+Config.rpc.port
const rpc = <BitcoinRpc.RpcClient>(new RpcClient(connectionString, console));

const db = new Db();
const bit = new Bit();

const daemon = {
    run: async function(start_height?: number) {
        if(start_height)
            await Info.updateBlockCheckpoint(start_height, null);

        // test RPC connection
        console.log("[INFO] Testing RPC connection...");
        await rpc.getBlockCount();
        console.log("[INFO] JSON-RPC is initialized.");

        // set network
        await Info.setNetwork((await rpc.getInfo())!.testnet ? 'testnet' : 'mainnet');

        // check for confirmed collection schema update
        let schema = await Info.getConfirmedCollectionSchema();
        if(!schema || schema !== Config.db.confirmed_schema_version) {
            await Info.setConfirmedCollectionSchema(Config.db.confirmed_schema_version);
            await Info.checkpointReset();
            console.log("[INFO] Schema version for the confirmed collection was updated. Reseting block checkpoint reset to", (await Info.getBlockCheckpoint()).height)
        }

        await db.init(rpc);
        await bit.init(db, rpc);

        const lastSynchronized = <ChainSyncCheckpoint>await Info.getBlockCheckpoint((await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet);
        let reprocessFrom = lastSynchronized.height;
        if(lastSynchronized.height > await bit.requestheight()) {
            throw Error("Config.core.from or Config.core.from_testnet cannot be larger than the current blockchain height (check the config.ts file)");
        }

        console.time('[PERF] Indexing Keys');
        let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
        if (lastSynchronized.height === from) {
            console.log('[INFO] Indexing MongoDB With Configured Keys...', new Date());
            await db.confirmedIndex();
        }
        console.timeEnd('[PERF] Indexing Keys');

        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());

        console.log('[INFO] Starting to processing SLP Data.', new Date());
        let tokenManager = new SlpGraphManager(db);
        bit._zmqSubscribers.push(tokenManager);
        await tokenManager.initAllTokens(reprocessFrom);
        await bit.handleConfirmedTxnsMissingSlpMetadata();
        await tokenManager.fixMissingTokenTimestamps();
        await tokenManager.searchForNonSlpBurnTransactions();
        await bit.checkForMissingMempoolTxns(undefined, true);
        bit.listenToZmq();

        // Every minute - Check mempool transactions - ZMQ failsafe
        setInterval(async function() {
            await bit.checkForMissingMempoolTxns();
        }, 60000);

        // Every minute - Check ZMQ block count - ZMQ failsafe
        // setInterval(async function() {
        //     await bit.checkCurrentBlockHeight();
        // }, 60000);
    }
}

const util = {
    run: async function() {
        const rpc = <BitcoinRpc.RpcClient>(new RpcClient(connectionString, console));
        await db.init(rpc)
        let cmd = process.argv[2]
        if (cmd === 'fix') {
            console.log("Command not implemented");
            let fromHeight: number;
            // if (process.argv.length > 3) {
            // 	fromHeight = parseInt(process.argv[3])
            // 	await util.fix(fromHeight)
            // } else
            // 	console.log("Usage 'node ./index.js fix <block number>'")
            process.exit()
        } else if (cmd === 'reset') {
            await db.confirmedReset()
            await db.unconfirmedReset()
            await db.tokenReset()
            await db.graphReset()
            await db.utxoReset()
            await db.addressReset()
            await Info.checkpointReset()
            process.exit()
        } else if (cmd === 'index') {
            console.log("Command not implemented");
            //await db.blockindex()
            process.exit()
        }
    }//,
    //fix: async function(height: number) {
        // const rpc = <BitcoinRpc.RpcClient>(new RpcClient(connectionString));
        // await bit.init(db, rpc)
        // let tokenManager = new SlpGraphManager(db);
        // bit._zmqSubscribers.push(tokenManager);
        // console.log('[INFO] Clearing all unconfirmed transactions');
        // await db.unconfirmedReset();
        // console.log('[INFO] Fixing SLPDB after block', height);
        // console.time('[PERF] replace')
        // let content = await bit.crawl(height, true)
        // if(content) {
        // 	let array = Array.from(content.values()).map(c => c.tnaTxn)
        // 	await db.confirmedReplace(array, height)
        // }
        // console.log('[INFO] Block', height, 'fixed.')
        // await bit.removeExtraneousMempoolTxns()
        // console.timeEnd('[PERF] replace')
    //}
}

const start = async function() {
    try {
        if (process.argv.length > 3) {
            await daemon.run(parseInt(process.argv[3]));
        } else if (process.argv.length > 2) {
            await util.run();
        } else {
            await daemon.run();
        }
    } catch(err) {
        console.log(err);
        process.exit();
    }
}

start();
