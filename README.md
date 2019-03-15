
# SLPDB Readme
**Last Updated:** 2019-03-15

**Current SLPDB Version:** 0.9.0 (beta)



## Introduction

SLPDB is a node.js application that stores all token data for the Simple Ledger Protocol.  SLPDB requires MongoDB and a Bitcoin Cash full node to fetch, listen for, and store all pertinent SLP related data.  Additionally, this application allows other processes to subscribe to realtime SLP events via ZeroMQ subscription.  It is recommended that end users utilize the [slpserve](https://github.com/fountainhead-cash/slpserve) and [slpsocket](https://github.com/simpleledger/sockserve) applications in order to conveniently access the data that is provided by SLPDB and MongoDb.

You only need to install SLPDB, slpserve, and/or slpsocket if any of the following is true:
* You cannot rely on a third-party for your SLP data.
* SLP data query API offered at `slpdb.bitcoin.com` does not meet your needs.
* Realtime SLP data event notifications available at `___.___.___` does not meet your needs.



## Installation

### Prerequisites
* Node.js 8.15+
* MongoDB X.X
* BitcoinBU, BitcoinABC or other Bitcoin Cash full node with RPC-JSON and ZeroMQ event notifications

### Full Node Settings — `bitcoin.conf`
The following settings should be applied to your full node's configuration.  NOTE: The settings presented here are matched up with the default settings presented in `config.ts`, you should modify these settings and use environment variables (shown in `config.ts`) if you need a custom setup.
* `server=1`
* `rpcuser=bitcoin`
* `rpcpassword=password`
* `rpcport=8332`
* `rpcworkqueue=1000`
* `rpcthreads=8`
* `zmqpubhashtx=tcp://127.0.0.1:28332`
* `zmqpubrawtx=tcp://127.0.0.1:28332`
* `zmqpubhashblock=tcp://127.0.0.1:28332`
* `zmqpubrawblock=tcp://127.0.0.1:28332`
* Optional: `testnet=1`

### Running SLPDB (without Docker)

1) Run MongoDB locally (`congif.ts` default port is 27017)

* [Get started with MongoDB](https://www.mongodb.com/download-center?jmp=docs)

2) Run Full Node locally, using `bitcoin.conf` settings above.

* [BitcoinABC](https://www.bitcoinabc.org)
* [BitcoinBU](https://www.bitcoinunlimited.info)

3) [Install node.js](https://nodejs.org/en/download/)

4) Install SLPDB dependencies using `npm install` at the command-line

5) Start SLPDB using `npm start` at the command-line and wait for sync process to complete (monitor status in the console).

    * First SLPDB will need to sync all SLP transactions since SLP started
    * Second SLPDB will build token graphs for each token

6) Install and run [slpserve](https://github.com/fountainhead-cash/slpserve) and/or [slpsocket](https://github.com/simpleledger/sockserve) to access SLP token data and statistics

### Running SLPDB using Docker Compose
TODO



## SlpServe Data Queries

TODO



## Real-time SLP Notifications

### ZeroMQ (ZMQ)

SLPDB publishes the following notifications via [ZMQ](http://zeromq.org/intro:read-the-manual) and can be subscribed to by binding to http://0.0.0.0:28339.  The following events can be subscribed to:
* `mempool-slp-genesis`
* `mempool-slp-mint`
* `mempool-slp-send`
* `block-slp-genesis`
* `block-slp-mint`
* `block-slp-send`

Each notification is published in the following data format:

```json
{
  txid: string,
  slp: {
     valid: boolean,
     detail: { 	
       	decimals: number;
      	tokenIdHex: string;
        transactionType: string;
        versionType: number;
        documentUri: string|null;
        documentSha256Hex: string|null;
        symbol: string|null;
        name: string|null;
        txnBatonVout: number|null;
        txnContainsBaton: boolean|null;
        outputs: string[];
  	},
    invalidReason: string|null;
  	schema_version: number;
  }
}
```

### SlpSocket
TODO



## Other Notes

* Using different networks (e.g., mainnet vs testnet) require `db.name` within `config.ts` should be unique for each network.

* `rpcworkqueue` within bitcoin.conf should be set to something large, try `rpcworkqueue=1000`.

* The following are being calculated and updated in real-time:
    - `qty_valid_txns_since_genesis`
    - `qty_valid_token_utxos`
    - `qty_valid_token_addresses`
    - `qty_token_circulating_supply`
    - `qty_token_burned`
    - `qty_token_minted`
    - `qty_satoshis_locked_up`

* The following stats are not being computed yet:
    - `block_created`
    - `block_last_active_mint`
    - `block_last_active_send`