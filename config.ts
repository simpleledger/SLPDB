export interface DbConfig { 
	name: string;
	name_testnet: string;
	url: string;
	lazy_loading: number;
	index: { [key: string]: { [key: string]: string[] } };
	token_schema_version: number;
	confirmed_schema_version: number;
}

export type CollectionType = { keys: string[], fulltext: string[] }

export interface RpcConfig { 
	protocol: string; user: string; pass: string; host: string; port: string; limit: number; 
}

export class Config {
	static rpc = {
		protocol: process.env.rpc_protocol ? process.env.rpc_protocol : 'http',
		user: process.env.rpc_user ? process.env.rpc_user : 'bitcoin',
		pass: process.env.rpc_pass ? process.env.rpc_pass : 'password',
		host: process.env.rpc_host ? process.env.rpc_host : '0.0.0.0',
		port: process.env.rpc_port ? process.env.rpc_port : '8332',
		limit: Number.parseInt(process.env.rpc_limit ? process.env.rpc_limit : "150"),
		rpcMaxRetries: Number.parseInt(process.env.rpc_max_retries ? process.env.rpc_max_retries : "2"),
		rpcRetryDelayMs: Number.parseInt(process.env.rpc_retry_delay ? process.env.rpc_retry_delay : "1000"),
		rpcTimeoutMs: Number.parseInt(process.env.rpc_timeout ? process.env.rpc_timeout : "30000"),
		skipInitialSyncCheck: process.env.skip_intial_sync_check ? ['1', 'true'].includes(process.env.skip_intial_sync_check) : false,
	}
	static grpc = {
		url: Boolean(process.env.grpc_url) ? process.env.grpc_url : undefined,
		certPath: Boolean(process.env.grpc_certPath) ? process.env.grpc_certPath : undefined,
	}
	static db: DbConfig = {
		name: process.env.db_name ? process.env.db_name : 'slpdb',
		name_testnet: process.env.db_name ? process.env.db_name + "_test" : 'slpdb_test',
		url: process.env.db_url ? process.env.db_url : 'mongodb://127.0.0.1:27017',
		confirmed_schema_version: 2,
		token_schema_version: 79,
		lazy_loading: process.env.lazy_loading ? Number.parseInt(process.env.lazy_loading) : 0,
		index: {
			tokens: {
				keys: [ 'tokenDetails.tokenIdHex', 'tokenDetails.name', 'tokenDetails.symbol', 'tokenStats.qty_token_circulating_supply', 'tokenStats.qty_token_burned', 'tokenStats.qty_token_minted' ],
				fulltext: [ 'tokenDetails.name', 'tokenDetails.symbol' ]
			},
			graphs: {
				keys: [ 'tokenDetails.tokenIdHex', 'tokenDetails.nftGroupIdHex', 'graphTxn.txid', 'graphTxn.outputs.spendTxid'],
				fulltext: [ ]
			},
			confirmed: {
				keys: [
					'tx.h', 'blk.i', 'blk.t', 'blk.h',
					'in.e.a', 'in.e.h', 'in.e.i', 'in.i',
					'out.e.a', 'out.e.i', 'out.e.v', 'out.i',
					'in.b0', 'in.b1', 'in.b2', 'in.b3', //'in.b4', 'in.b5', 'in.b6', 'in.b7', 'in.b8', 'in.b9', 'in.b10', 'in.b11', 'in.b12', 'in.b13', 'in.b14', 'in.b15',
					'out.b0', 'out.b1', 'out.b2', 'out.b3', 'out.b7', //'out.b4', 'out.b5', 'out.b6', 'out.b7', 'out.b8', 'out.b9', 'out.b10', 'out.b11', 'out.b12', 'out.b13', 'out.b14', 'out.b15', 'out.b16', 'out.b17', 'out.b18', 'out.b19',
					'out.s0', 'out.s1', 'out.s2', 'out.s3', 'out.s4', //'out.s5'
					'slp.detail.outputs.address', 'slp.detail.transactionType'
				],
				fulltext: ['out.s0', 'out.s1', 'out.s2', 'out.s3']//, 'out.s4', 'out.s5']
			},
			unconfirmed: {
				keys: [
					'tx.h',
					'in.e.a', 'in.e.h', 'in.e.i', 'in.i',
					'out.e.a', 'out.e.i', 'out.e.v', 'out.i',
					'in.b0', 'in.b1', 'in.b2', 'in.b3',     //'in.b4', 'in.b5', 'in.b6', 'in.b7', 'in.b8', 'in.b9', 'in.b10', 'in.b11', 'in.b12', 'in.b13', 'in.b14', 'in.b15',
					'out.b0', 'out.b1', 'out.b2', 'out.b3', 'out.b7', //'out.b4', 'out.b5', 'out.b6', 'out.b7', 'out.b8', 'out.b9', 'out.b10', 'out.b11', 'out.b12', 'out.b13', 'out.b14', 'out.b15', 'out.b16', 'out.b17', 'out.b18', 'out.b19',
					'out.s0', 'out.s1', 'out.s2', 'out.s3', 'out.s4', //'out.s5'
					'slp.detail.outputs.address', 'slp.detail.transactionType'
				],
				fulltext: ['out.s0', 'out.s1', 'out.s2', 'out.s3'] //, 'out.s4', 'out.s5']
			}
		}
	}
	static zmq = {
		incoming: {
			host: process.env.zmq_incoming_host ? process.env.zmq_incoming_host : '0.0.0.0',
			port: process.env.zmq_incoming_port ? process.env.zmq_incoming_port : '28332',
		},
		outgoing: {
			enable: process.env.zmq_outgoing_enable ? ['1', 'true'].includes(process.env.zmq_outgoing_enable) : true,
			host: process.env.zmq_outgoing_host ? process.env.zmq_outgoing_host : '0.0.0.0',
			port: process.env.zmq_outgoing_port ? process.env.zmq_outgoing_port : '28339',
		}
	}
	static core = {
		from: Number.parseInt(process.env.core_from ? process.env.core_from : "543375"),
		from_testnet: Number.parseInt(process.env.core_from_testnet ? process.env.core_from_testnet : "1253801"),
		slp_mempool_ignore_length: Number.parseInt(process.env.core_slp_mempool_ignore_length ? process.env.core_slp_mempool_ignore_length : "1000000"),
	}
	static telemetry = {
		enable: process.env.telemetry_enable ? ['1', 'true'].includes(process.env.telemetry_enable) : true,
		host: process.env.telemetry_host ? process.env.telemetry_host : 'status.slpdb.io',
		port: process.env.telemetry_port ? process.env.telemetry_port : 443,
		advertised_host: process.env.telemetry_advertised_host ? process.env.telemetry_advertised_host : '',
		secret: process.env.telemetry_secret ? process.env.telemetry_secret : ''
	}
}
