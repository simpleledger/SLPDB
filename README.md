
# SLPDB Readme
**Last Updated:** 2019-03-16

**Current SLPDB Version:** 0.9.1 (beta)



## Introduction

SLPDB is a node.js application that stores all token data for the Simple Ledger Protocol.  SLPDB requires MongoDB and a Bitcoin Cash full node to fetch, listen for, and store all SLP data.  Additionally, this application allows other processes to subscribe to real-time SLP events via ZeroMQ subscription.  It is recommended that end users utilize the [slpserve](https://github.com/fountainhead-cash/slpserve) and [slpsocket](https://github.com/simpleledger/sockserve) applications in order to conveniently access the data that is provided by SLPDB and MongoDB.

SLPDB enables access to useful SLP data (use [slpserve](https://github.com/fountainhead-cash/slpserve) to run linked examples):
* List all token details and useage information [slpserve example](http://localhost:3000/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgeyB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* Token details and useage information by token ID [slpserve example](http://localhost:3000/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgewogICAgICAgICJ0b2tlbkRldGFpbHMudG9rZW5JZEhleCI6ICI5NTlhNjgxOGNiYTVhZjhhYmEzOTFkM2Y3NjQ5ZjVmNmE1Y2ViNmNkY2QyYzJhM2RjYjVkMmZiZmM0YjA4ZTk4IgogICAgICB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* List all address balances by token ID [slpserve example](http://localhost:3000/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJmaW5kIjogewogICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIsCiAgICAgICJ0b2tlbl9iYWxhbmNlIjogeyAiJGd0ZSI6IDAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAwMCwKICAgICJwcm9qZWN0IjogeyJhZGRyZXNzIjogMSwgInNhdG9zaGlzX2JhbGFuY2UiOiAxLCAidG9rZW5fYmFsYW5jZSI6IDEsICJfaWQiOiAwIH0KICB9Cn0=)
* List all token balances by address [slpserve example](http://localhost:3000/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYSJdLCAKICAgICJmaW5kIjogewogICAgICAiYWRkcmVzcyI6ICJzaW1wbGVsZWRnZXI6cXJkbDBoZWswd3ltZHV4a3k0bHFxMzd1am1lODIyYWc5eTBoejJ3dnFxIiwKICAgICAgInRva2VuX2JhbGFuY2UiOiB7ICIkZ3RlIjogMCB9CiAgICB9LAogICAgImxpbWl0IjogMTAwMDAKICB9LCAKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHRva2VuSWQ6IC50b2tlbkRldGFpbHMudG9rZW5JZEhleCwgc2F0b3NoaXNfYmFsYW5jZTogLnNhdG9zaGlzX2JhbGFuY2UsIHRva2VuX2JhbGFuY2U6IC50b2tlbl9iYWxhbmNlIH1dIgogIH0KfQ==)
* List all token utxos by token ID [slpserve example](http://localhost:3000/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsieCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjogeyAKICAgICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIgCiAgICAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAwCiAgfSwKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHRva2VuSWQ6IC50b2tlbkRldGFpbHMudG9rZW5JZEhleCwgdXR4bzogLnV0eG8gfV0iCiAgfQp9)
* List transaction history by token ID (example coming soon)
* List transaction history by address (example coming soon)
* List transaction history by address and token ID (example coming soon)
* Show total circulating token supply for a token ID (example coming soon)
* Show total token supply burned for a token ID (example coming soon)
* Show current state of a token's minting baton (example coming soon)
* Show invalid token transactions [slpserve example](http://localhost:3000/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6IHsKICAgICAgInNscC52YWxpZCI6IGZhbHNlCiAgICB9LAogICAgImxpbWl0IjogMzAwLAogICAgInByb2plY3QiOiB7InR4LmgiOiAxfQogIH0sCiAgInIiOiB7CiAgICAiZiI6ICJbLltdIHwge3R4aWQ6IC50eC5ofV0iCiAgfQp9)

You only need to install SLPDB, slpserve, and/or slpsocket if any of the following is true:
* You cannot rely on a third-party for your SLP data.
* SLP data query API offered at `slpdb.bitcoin.com` does not meet your needs.
* Realtime SLP data event notifications available at `___.___.___` does not meet your needs.

## Installation

### Prerequisites
* Node.js 8.15+
* MongoDB 4.0+
* BitcoinBU, BitcoinABC or other Bitcoin Cash full node with:
  * RPC-JSON and 
  * ZeroMQ event notifications



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

### Testnet Support

To use SLPDB with Testnet simply set your full node to the testnet network (e.g., set `testnet=1` within `bitcoin.conf`) and SLPDB will automatically instantiate using proper databases names according to the network.  For informational purposes the database names are as follows:
* **Mainnet**
  * Mongo db name = `slpdb`
  * LevelDB directory = `./_leveldb`
* **Testnet**
  * Mongo db name = `slpdb_testnet`
  * Testnet diectory = `./_leveldb_testnet`

### Running SLPDB

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

## SLP Token Statistics

The following statistics are maintained for each token:

### Supply Statistics
  * `qty_token_minted` = Total token quantity created in GENESIS and MINT transactions 
  * `qty_token_burned` = Total token quantity burned in invalid SLP transactions or in transactions having lower token outputs than inputs.
  * `qty_token_circulating_supply` = Total quantity of tokens circulating (i.e., Genesis + Minting - Burned = Circulating Supply).
  * `minting_baton_status`  = State of the minting baton (possible baton status: `ALIVE`, `NEVER_CREATED`, `DEAD_BURNED`, or `DEAD_ENDED`).
  * `mint_baton_address (NOT YET IMPLEMENTED)` = Address holding the minting baton or last address to hold.
  * `mint_baton_txid (NOT YET IMPLEMENTED)` = TXID where the minting baton exists or existed before being destroyed.

### Useage Statistics
  * `qty_valid_txns_since_genesis` = Number of valid SLP transactions made since Genesis (Includes GENESIS, SEND and MINT transactions)
  * `qty_valid_token_utxos` = Number of current unspent & valid SLP UTXOs
  * `qty_valid_token_addresses` = Number of unique address holders
  * `qty_satoshis_locked_up` = Quantity of BCH that is locked up in SLP UTXOs
  * `block_last_active_mint` - The block containing the token's MINT transaction
  * `block_last_active_send` - The block containing the token's SEND transaction
  * `block_created` - The block containing the token's GENESIS transaction


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

```ts
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

## MongoDB Data Schema
MongoDB is used to persist all token data. The following db collections are used:
 * `confirmed` - Includes any confirmed Bitcoin Cash Transaction that includes "SLP" lokadID in the first output
 * `unconfirmed` - Same as confirmed except includes transactions within the BCH mempool
 * `tokens` - Includes metadata and statistics for each valid token
 * `utxos` - Includes all valid SLP UTXOs holding a token (does not include mint baton UTXOs)
 * `addresses` - Includes all addresses with a token balance
 * `graphs` - Includes all valid SLP txids (can be GENESIS, MINT, and SEND)

## TokenID Filtering (Coming Soon)
SLPDB will soon include tokenID filtering so that only user specified tokens (or ranges of tokens) will be included or excluded.

### SlpSocket
TODO

