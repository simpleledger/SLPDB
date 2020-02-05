const level = require('level');
var kv = level('./_leveldb');
import * as crypto from 'crypto';

import { Config } from './config';

/**
* Return the last synchronized checkpoint
*/

export interface ChainSyncCheckpoint {
	height: number;
	hash: string|null;
	hadReorg?: boolean;
}

export module Info {

	export const setNetwork =  async function(network: string): Promise<void> {
		try {
			if(network === 'testnet')
				kv = level('./_leveldb_testnet');
			await kv.put('network', network);
		} catch(_) { }
	}

	export const getNetwork =  async function(): Promise<string> {
		try {
			return await kv.get('network');
		} catch(_) { 
			throw Error("Cannot get network");
		}
	}

	export const getTelemetryName = async function(): Promise<string> {
		if(Config.telemetry.advertised_host) {
			return Config.telemetry.advertised_host;
		} else {
			try {
				return await kv.get('telname');
			} catch(_) {
				let name = 'unknown-' + Math.floor(Math.random()*100000).toFixed(0);
				await kv.put('telname', name);
				return name;
			}
		}
	}

	export const setTelemetrySecret = async function(secret: string): Promise<void> {
		if(Config.telemetry.secret)
			await kv.put('telsecret', Config.telemetry.secret);
		else if(secret)
			await kv.put('telsecret', secret);
	}

	export const getTelemetrySecret = async function(): Promise<string> {
		try {
			return await kv.get('telsecret');
		} catch(_) {
			return '';
		}
	}

	export const getTelemetrySecretHash = async function(): Promise<string|null> {
		let secret;
		if(Config.telemetry.secret)
			secret = Config.telemetry.secret;
		else {
			try {
				secret = await kv.get('telsecret');
			} catch(_) {
				return null;
			}
		}
		let hash = crypto.createHash('sha256');
        return hash.update(Buffer.from(secret, 'hex')).digest().toString('hex').substring(0, 40);
	}

	export const getBlockCheckpoint = async function(fallback_index?: number): Promise<ChainSyncCheckpoint> {
		let value: number|null, hash: string|null;
		try {
			value = parseInt(await kv.get('tip'));
		} catch(_) { value = null; }
		
		try {
			hash = await kv.get(value + '-hash');
		} catch(_) { hash = null; }

		if (value !== null && hash) {
			console.log("[INFO] Block checkpoint retrieved: ", value, hash);
			return { height: value!, hash: hash }
		} else if (value !== null) {
			console.log("[INFO] Block checkpoint retrieved without block hash:", value);
			return { height: value!, hash: null }
		} else if(fallback_index !== undefined && fallback_index >= 0) {
			console.log("[INFO] Block checkpoint not found, falling back to block", fallback_index);
			return { height: fallback_index, hash: null }
		}
		throw Error("Could not retrieve checkpoint from storage for block: " + value);
	}

	export const updateBlockCheckpoint = async function(index: number, hash: string|null): Promise<void> {
		try {
			await kv.put('tip', index);
			if(hash)
				await kv.put(index + '-hash', hash);
			console.log("[INFO] Block checkpoint updated to:", index, hash);
		} catch (err) {
			console.log('[ERROR] updateBlockCheckpoint error:', err)
		}
	}

	export const checkpointReset = async function() {
		let start = (await Info.getNetwork()) === 'mainnet' ? Config.core.from : Config.core.from_testnet;
		await Info.updateBlockCheckpoint(start, null);
	}

	export const getCheckpointHash = async function(index: number) {
		try {
			return await kv.get(index + '-hash');
		} catch(_) {}
		return null
	}

	export const getRecentBlocks = async (currentBlock: { hash: string, height: number }): Promise<{ hash: string, height: number }[]> => {
		let recentBlocks: { hash: string, height: number }[] = [];
		let tip = (await Info.getBlockCheckpoint()).height;
		let hash = await Info.getCheckpointHash(tip);
		while(hash && recentBlocks.length < 9) {
			recentBlocks.unshift({ hash, height: tip });
			hash = await Info.getCheckpointHash(--tip);
		}
		recentBlocks.push({ hash: currentBlock.hash, height: currentBlock.height });
		return recentBlocks;
	}

	// export const deleteTip = async function() {
	// 	try { 
	// 		await kv.del('tip');
	// 		console.log("[INFO] Block checkpoint deleted.");
	// 	} catch(err) {
	// 		console.log('[ERROR] deleteTip err', err)
	// 	}
	// }

	export const deleteBlockCheckpointHash = async function (index: number) {
		try { 
			await kv.del(index + '-hash');
	 		console.log("[INFO] Block hash record deleted for", index);
		} catch(err) {
			console.log('[ERROR] deleteTip err', err)
		}
	}

	export const getConfirmedCollectionSchema = async function(): Promise<number|null> {
		try {
			return parseInt(await kv.get('confirmedSchemaVersion'));
		} catch(_) { }
		return null;
	}

	export const setConfirmedCollectionSchema = async function(version: number) {
		return await kv.put('confirmedSchemaVersion', version);
	}

	// Used for future lazy loading -- this is in commented code and not currently utilized
	export const getLastBlockSeen = async function(tokenId: string): Promise<number|null> {
		try {
			return parseInt(await kv.get(`lastSeen-${tokenId}`));
		} catch(_) {
			return null;
		}
	}

	// Used for future lazy loading -- this is in commented code and not currently utilized
	export const setLastBlockSeen = async function(tokenId: string, block: number) {
		return await kv.put(`lastSeen-${tokenId}`, block);
	}
}