import * as dotenv from 'dotenv';
dotenv.config()

import { Config } from './config';
import { Info, ChainSyncCheckpoint } from './info';
import { Bit } from './bit';
import { Db } from './db';
import { SlpGraphManager } from './SlpGraphManager';

import { RpcClient } from './rpc';
const rpc = new RpcClient({useGrpc: Boolean(Config.grpc.url) });

const db = new Db();
const bit = new Bit();

const daemon = {
    run: async function(start_height?: number) {

        // test RPC connection
        console.log("[INFO] Testing RPC connection...");
        await rpc.getBlockCount();
        console.log("[INFO] RPC is initialized.");

        // set network
        await Info.setNetwork((await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet');

        // set start height override
        if(start_height)
            await Info.updateBlockCheckpoint(start_height, null);

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
        bit._slpGraphManager = tokenManager;
        bit.listenToZmq();
        await bit.checkForMissingMempoolTxns(undefined, true);

        await tokenManager.initAllTokens({ reprocessFrom });
        await bit.handleConfirmedTxnsMissingSlpMetadata();
        await tokenManager.fixMissingTokenTimestamps();
        await tokenManager.searchForNonSlpBurnTransactions();

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
        const rpc = new RpcClient({useGrpc: Boolean(Config.grpc.url) });
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
    }, 
    reprocess_token: async function(tokenId: string) {
        await Info.setNetwork((await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet');
        await db.init(rpc);
        await bit.init(db, rpc);
        console.log('[INFO] Synchronizing SLPDB with BCH blockchain data...', new Date());
        console.time('[PERF] Initial Block Sync');
        await bit.processBlocksForTNA();
        await bit.processCurrentMempoolForTNA();
        console.timeEnd('[PERF] Initial Block Sync');
        console.log('[INFO] SLPDB Synchronization with BCH blockchain data complete.', new Date());
        let tokenManager = new SlpGraphManager(db);
        await tokenManager.initAllTokens({ reprocessFrom: 0, tokenIds: [tokenId], loadFromDb: false });
        tokenManager._tokens.get(tokenId)!.updateStatistics();
        process.exit();
    //}
    },
    reset_to_block: async function(block_height: number) {  //592340
        let tokenIdFilter = [
            // "04045592bddf759c2124f9c4fa23b1db50e9a40a58506e5589231e4d0cf23d1d",
            // "05fc74553285fb76fbbc6dbc649875abcdd87c589f3c279b21b3ae96835d7988",
            // "0be40e351ea9249b536ec3d1acd4e082e860ca02ec262777259ffe870d3b5cc3",
            // "1cda254d0a995c713b7955298ed246822bee487458cd9747a91d9e81d9d28125",
            // "56e104b3a19dc2b67867312431063e5d90d3985df0f98aa75ea90067b1224f59",
            // "66342812be19bcd76190438fa090e8576ba7cb99887bb3df084253ce4752b0dd",
            // "7f8889682d57369ed0e32336f8b7e0ffec625a35cca183f4e81fde4e71a538a1",
            // "89b6bfb47532b3299a87b883da76dc113523d84dd8b631b581a8064822924212",
            "8aab2185354926d72c6a8f6bf7e403daaf1469c02e00a5ad5981b84ea776d980",
            // "9d383d1ce9afaea57353523754d9185dd5fb4594f807308c2b3e9ede591c1492",
            // "a732350b9459a428b3da41e3c6505aebb46c46b4103464e33e6362efa36e5d33",
            // "b6ed86f3f5de0682cd80d628a10f2fc26caccd726e6ba1d17b8eebdec783aa14",
            // "bb1317976ec78e6382515720d77a40b8b619ef715dabc64ef69dcb683ee79653",
            // "d806e14b89829adc6c576da5729e34495d9b547ccd7162b827d5a22ca9f989f7",
            // "da1219886fdeafc19267db6e9ed091b82ecab93c7a7d26e01dc1c48213877c32",
            // "f35007140e40c4b6ce4ecc9ad166101ad94562b3e4f650a30de10b8a80c0b987",
            // "4abbea22956e7db07ac3ae7eb88b14f23ccc5dce4273728275cb17ec91e6f57c"
        ]
        await Info.setNetwork((await rpc.getBlockchainInfo())!.chain === 'test' ? 'testnet' : 'mainnet');
        await db.init(rpc);
        let tokenManager = new SlpGraphManager(db);
        await tokenManager.initAllTokens({ reprocessFrom: 0, tokenIds: tokenIdFilter, reprocessTo: block_height });
        //await tokenManager.initAllTokens({ allowGraphUpdates: false, tokenIds: tokenIdFilter });
        //await tokenManager.simulateOnTransactionHash("06e27bfcd9f8839ea6c7720a6c50f68465e3bc56775c7a683dcb29f799eba24a");
        let blockhash = await rpc.getBlockHash(block_height+1);
        await tokenManager.onBlockHash(blockhash, tokenIdFilter);
        await Info.updateBlockCheckpoint(block_height, null);
        process.exit();
    }
    //,
    //fix: async function(height: number) {
        // const rpc = <BitcoinRpc.RpcClient>(new RpcClient({useGrpc: Boolean(Config.grpc.url) }));
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
        let args = process.argv;
        if (args.length > 3) {
            if(args[2] === "run")
                await daemon.run(parseInt(process.argv[3]));
            else if(args[2] === "reprocess")
                await util.reprocess_token(process.argv[3]);
            else if(args[2] === "goToBlock")
                await util.reset_to_block(parseInt(process.argv[3]));
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
