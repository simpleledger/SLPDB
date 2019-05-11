const level = require('level');
var kv = level('./_leveldb');

import { Config } from './config';
import { TokenDBObject, UtxoDbo, GraphTxnDbo, AddressBalancesDbo } from './SlpTokenGraph';
import { Decimal128 } from 'bson';

/**
* Return the last synchronized checkpoint
*/

export interface ChainSyncCheckpoint {
	height: number, 
	hash: string|null 
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

	export const getBlockCheckpoint = async function(fallback_index?: number): Promise<ChainSyncCheckpoint> {
		let value: number|null, hash: string|null;
		try {
			value = parseInt(await kv.get('tip'));
		} catch(_) { value = null; }
		
		try {
			hash = await kv.get(value + '-hash');
		} catch(_) { hash = null; }

		if (value && hash) {
			console.log("[INFO] Block checkpoint retrieved: ", value, hash);
			return { height: value!, hash: hash }
		} else if(value) {
			console.log("[INFO] Block checkpoint retrieved without block hash:", value);
			return { height: value!, hash: null }
		} else if(fallback_index) {
			console.log("[INFO] Block checkpoint not found, falling back to block", fallback_index);
			return { height: fallback_index, hash: null }
		}
		throw Error("Could not retrieve checkpoint from storage.");
	}

	export const updateBlockCheckpoint = async function(index: number, hash: string|null): Promise<void> {
		try {
			await kv.put('tip', index);
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

	// export const deleteTip = async function() {
	// 	try { 
	// 		await kv.del('tip');
	// 		console.log("[INFO] Block checkpoint deleted.");
	// 	} catch(err) {
	// 		console.log('[ERROR] deleteTip err', err)
	// 	}
	// }

	export const deleteBlockCheckpointHash = async function (index: number){
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
		try {
			return await kv.put('confirmedSchemaVersion', version);
		} catch(err) {
			throw Error(err.message);
		 }
	}

	export const saveTokensState = async function(tokens: TokenDBObject[]) {
		try {
			let json = JSON.stringify(tokens)
			await kv.put('token-state', json)
		} catch(err) {
			console.log('[ERROR] Writing tokens state to leveldb')
		}
	}

	export const loadTokensState = async function(): Promise<TokenDBObject[]|undefined> {
		const reviver = (k: any, v: any)  => {
			if(k === "genesisOrMintQuantity")
				return Decimal128.fromString(v["$numberDecimal"]);
			return v;
		}
		try {
			let res = JSON.parse(await kv.get('token-state'), reviver);
			return res;
		} catch(err) {
			console.log('[ERROR] Reading tokens state from leveldb')
		}
	}

	export const saveUtxosState = async function(utxos: UtxoDbo[]) {
		try {
			let json = JSON.stringify(utxos)
			await kv.put('utxo-state', json)
		} catch(err) {
			console.log('[ERROR] Writing utxos state to leveldb')
		}
	}

	export const loadUtxosState = async function(): Promise<UtxoDbo[]|undefined> {
		const reviver = (k: any, v: any)  => { 
			if(k === "slpAmount")
				return Decimal128.fromString(v["$numberDecimal"]);
			return v;
		}
		try {
			let res = JSON.parse(await kv.get('utxo-state'), reviver)
			return res;
		} catch(err) {
			console.log('[ERROR] Reading utxos state from leveldb')
		}
	}

	export const saveGraphsState = async function(graphs: GraphTxnDbo[]) {
		try {
			let json = JSON.stringify(graphs)
			await kv.put('graph-state', json)
		} catch(err) {
			console.log('[ERROR] Writing graph state to leveldb')
		}
	}

	export const loadGraphsState = async function(): Promise<GraphTxnDbo[]|undefined> {
		const reviver = (k: any, v: any)  => { 
			if(k === "sendOutputs")
				return v.map((o: any) => Decimal128.fromString(o["$numberDecimal"]))
			if(k === "slpAmount")
				return Decimal128.fromString(v["$numberDecimal"]);
			return v;
		}
		try {
			let res = JSON.parse(await kv.get('graph-state'), reviver);
			return res;
		} catch(err) {
			console.log('[ERROR] Reading graph state from leveldb')
		}
	}

	export const saveAddressState = async function(addresses: AddressBalancesDbo[]) {
		try {			
			let json = JSON.stringify(addresses)
			await kv.put('address-state', json)
		} catch(err) {
			console.log('[ERROR] Writing address state to leveldb')
		}
	}

	export const loadAddressState = async function(): Promise<AddressBalancesDbo[]|undefined> {
		const reviver = (k: any, v: any) => { 
			if(k === "token_balance")
				return Decimal128.fromString(v["$numberDecimal"]);
			return v;
		}
		try {
			let res = JSON.parse(await kv.get('address-state'), reviver)
			return res;
		} catch(err) {
			console.log('[ERROR] Reading address state from leveldb')
		}
	}
}