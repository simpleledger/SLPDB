import * as dotenv from 'dotenv';
dotenv.config()

import { Config } from './config';
import { Info } from './info';
import { Bit } from './bit';
import { Db } from './db';
import { SlpGraphManager } from './SlpGraphManager';

const db = new Db();
const bit = new Bit();

const daemon = {
	run: async function() {
		await db.init();
		await bit.init(db);

		const lastSynchronized = await Info.checkpoint();
		if(lastSynchronized.height > await bit.requestheight()) {
			throw Error("Config.core.from or Config.core.from_testnet cannot be larger than the current blockchain height (check the config.ts file)");
		}

		console.time('[PERF] Indexing Keys');
		let from = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
		if (lastSynchronized.height === from) {
			console.log('[INFO] Indexing MongoDB With Configured Keys...', new Date());
			await db.blockindex();
		}
		console.timeEnd('[PERF] Indexing Keys');

		console.log('[INFO] Synchronizing SLPDB with BCH blockchain...', new Date());
		console.time('[PERF] Initial Sync');
		await bit.run();
		console.timeEnd('[PERF] Initial Sync');
		console.log('[INFO] SLPDB Synchronization with BCH blockchain complete.', new Date());

		let tokenManager = new SlpGraphManager(db);
		
		await tokenManager.initAllTokens();

		bit._zmqSubscribers.push(tokenManager);
		bit.listenToZmq();
	}
}

const util = {
	run: async function() {
		await db.init()
		let cmd = process.argv[2]
		if (cmd === 'fix') {
			let fromHeight: number;
			if (process.argv.length > 3) {
				fromHeight = parseInt(process.argv[3])
			} else {
				fromHeight = (await Info.checkpoint()).height;
			}
			await util.fix(fromHeight)
			process.exit()
		} else if (cmd === 'reset') {
			await db.blockreset()
			await db.mempoolreset()
			await Info.deleteTip()
			process.exit()
		} else if (cmd === 'index') {
			await db.blockindex()
			process.exit()
		}
	},
	fix: async function(height: number) {
		console.log('[INFO] Restarting sync from index ', height)
		console.time('[PERF] replace')
		await bit.init(db)
		let content = await bit.crawl(height)
		if(content) {
			let array = Array.from(content.values()).map(c => c.tnaTxn)
			await db.blockreplace(array, height)
		}
		console.log('[INFO] Block', height, 'fixed.')
		await Info.updateTip(height, null)
		console.timeEnd('[PERF] replace')
	}
}

const start = async function() {
	try {
		if (process.argv.length > 2) {
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
