
# SLPDB Readme
**Last Updated:** 2019-03-19

**Current SLPDB Version:** 0.9.3 (beta)



## Introduction

SLPDB is a node.js application that stores all token data for the Simple Ledger Protocol.  SLPDB requires MongoDB and a Bitcoin Cash full node to fetch, listen for, and store SLP data.  The application allows other processes to subscribe to real-time SLP events via ZeroMQ.  However, it is recommended that end users utilize the [slpserve](https://github.com/fountainhead-cash/slpserve) and [slpsocket](https://github.com/simpleledger/sockserve) projects in order to conveniently access the SLP data produced by SLPDB.

SLPDB enables access to useful SLP data:

* List all token details and usage information [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgeyB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* Token details and useage information by token ID [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgewogICAgICAgICJ0b2tlbkRldGFpbHMudG9rZW5JZEhleCI6ICI5NTlhNjgxOGNiYTVhZjhhYmEzOTFkM2Y3NjQ5ZjVmNmE1Y2ViNmNkY2QyYzJhM2RjYjVkMmZiZmM0YjA4ZTk4IgogICAgICB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* List all address balances by token ID [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJmaW5kIjogewogICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIsCiAgICAgICJ0b2tlbl9iYWxhbmNlIjogeyAiJGd0ZSI6IDAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAwMCwKICAgICJwcm9qZWN0IjogeyJhZGRyZXNzIjogMSwgInNhdG9zaGlzX2JhbGFuY2UiOiAxLCAidG9rZW5fYmFsYW5jZSI6IDEsICJfaWQiOiAwIH0KICB9Cn0=)
* List all token balances by address [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYSJdLCAKICAgICJmaW5kIjogewogICAgICAiYWRkcmVzcyI6ICJzaW1wbGVsZWRnZXI6cXJkbDBoZWswd3ltZHV4a3k0bHFxMzd1am1lODIyYWc5eTBoejJ3dnFxIiwKICAgICAgInRva2VuX2JhbGFuY2UiOiB7ICIkZ3RlIjogMCB9CiAgICB9LAogICAgImxpbWl0IjogMTAwMDAKICB9LCAKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHRva2VuSWQ6IC50b2tlbkRldGFpbHMudG9rZW5JZEhleCwgc2F0b3NoaXNfYmFsYW5jZTogLnNhdG9zaGlzX2JhbGFuY2UsIHRva2VuX2JhbGFuY2U6IC50b2tlbl9iYWxhbmNlIH1dIgogIH0KfQ==)
* List all token utxos by token ID [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsieCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjogeyAKICAgICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIgCiAgICAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAwCiAgfSwKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHRva2VuSWQ6IC50b2tlbkRldGFpbHMudG9rZW5JZEhleCwgdXR4bzogLnV0eG8gfV0iCiAgfQp9)
* List transaction history by token ID (example coming soon)
* List transaction history by address (example coming soon)
* List transaction history by address and token ID (example coming soon)
* Show invalid token transactions [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6IHsKICAgICAgInNscC52YWxpZCI6IGZhbHNlCiAgICB9LAogICAgImxpbWl0IjogMzAwLAogICAgInByb2plY3QiOiB7InR4LmgiOiAxfQogIH0sCiAgInIiOiB7CiAgICAiZiI6ICJbLltdIHwge3R4aWQ6IC50eC5ofV0iCiAgfQp9)
* List transaction counts for each token [example](https://slpdbstage.bchdata.cash/explorer2/ewogICJ2IjogMywKICAicSI6IAogIHsiYWdncmVnYXRlIjoKICBbeyIkbWF0Y2giOnsiYmxrLnQiOnsgIiRndGUiOiAxNTUyODY3MjAwLCAiJGx0ZSI6IDE1NTI5NTM2MDB9fX0sCiAgeyIkZ3JvdXAiOnsiX2lkIjogIiRzbHAuZGV0YWlsLm5hbWUiLCAiY291bnQiOiB7IiRzdW0iOiAxfX19XSwibGltaXQiOjEwMH19)

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

**1)** Run MongoDB (`config.ts` default port is 27017)

**2)** Run Bitcoin Cash full node using `bitcoin.conf` settings from above.

* [BitcoinABC](https://www.bitcoinabc.org)
* [BitcoinBU](https://www.bitcoinunlimited.info)

**3)** Install SLPDB dependencies using `npm install` at the command-line

**4)** Start SLPDB using `npm start` at the command-line and wait for sync process to complete (monitor status in the console).

* SLPDB will need to crawl the blockchain to save all *previous* SLP transaction data to MongoDB

* After crawling SLPDB will build token graphs for each token using either the raw transaction data or a previously saved token graph state.

**5)** Install and run [slpserve](https://github.com/fountainhead-cash/slpserve) and/or [slpsocket](https://github.com/simpleledger/sockserve) to access SLP token data and statistics



## Token Stats

The following properties are maintained and updated for each token in real-time to provide state and usage information:

### Supply Stats
  * `qty_token_minted` = Total token quantity created in GENESIS and MINT transactions 
  * `qty_token_burned` = Total token quantity burned in invalid SLP transactions or in transactions having lower token outputs than inputs.
  * `qty_token_circulating_supply` = Total quantity of tokens circulating (i.e., Genesis + Minting - Burned = Circulating Supply).
  * `minting_baton_status`  = State of the minting baton (possible baton status: `ALIVE`, `NEVER_CREATED`, `DEAD_BURNED`, or `DEAD_ENDED`).
  * `mint_baton_address (NOT YET IMPLEMENTED)` = Address holding the minting baton or last address to hold.
  * `mint_baton_txid (NOT YET IMPLEMENTED)` = TXID where the minting baton exists or existed before being destroyed.

### Usage Stats
  * `qty_valid_txns_since_genesis` = Number of valid SLP transactions made since Genesis (Includes GENESIS, SEND and MINT transactions)
  * `qty_valid_token_utxos` = Number of current unspent & valid SLP UTXOs
  * `qty_valid_token_addresses` = Number of unique address holders
  * `qty_satoshis_locked_up` = Quantity of BCH that is locked up in SLP UTXOs
  * `block_last_active_mint` - The block containing the token's MINT transaction
  * `block_last_active_send` - The block containing the token's SEND transaction
  * `block_created` - The block containing the token's GENESIS transaction



## Real-time Notifications

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
        txnContainsBaton: boolean;
        outputs: string[];
  	},
    invalidReason: string|null;
  	schema_version: number;
  }
}
```



## MongoDB Collections & Data Schema

Three categories of information are stored in MongoDB:

1. Valid and invalid SLP token transactions,  
2. Statistical calculations about each token, and 
3. Token graph state 

Five MongoDB collections used to store these three categories of data, they are as follows:

 * `confirmed = c`  and `unconfirmed = u` 

    * **Purpose**: These two collections include any Bitcoin Cash transaction containing the "SLP" Lokad ID.  The collection used depends on the transaction's confirmation status . Both valid and invalid SLP transactions are included.  Whenever new SLP transactions are added to the Bitcoin Cash network they are immediately added to one of these collections.

    * **Schema**:

      ```js
      {
        "tx": {"h": string; }
        "in": Xput[];
        "out": Xput[];
        "blk": { "h": string; "i": number; "t": number; };
        "slp": {
          "valid": boolean|null;
          "detail": SlpTransactionDetailsTnaDbo|null;
          "invalidReason": string|null;
          "schema_version": number;
        }
      }
      ```

      

 * `tokens = t` 

    * **Purpose**: This collection includes metadata and statistics about each token.  Each time SLPDB has finished updating a token graph the associated items in this collection are updated.

    * **Schema**:

      ```js
      {
        "tokenDetails": SlpTransactionDetailsDbo;
        "tokenStats": TokenStats | TokenStatsDb;
        "lastUpdatedBlock": number;
        "schema_version": number;
      }
      ```

      

 * `utxos = x` 

    * **Purpose**: This collection contains an item for each valid UTXO holding a token (does not include mint baton UTXOs).

    * **Schema**:

      ```js
      {
        "tokenDetails": { tokenIdHex: string };
        "utxo": string; // formatted "<txid>:<vout>"
      }
      ```

      

 * `addresses = a` 

    * **Purpose**: This collection contains an item for each addresses holding a valid token balance, for each token.

    * **Schema**:

      ```js
      {
      	"tokenDetails": { tokenIdHex: string };
        "address": cashAddr;
        "satoshis_balance": number;
        "token_balance": Decimal128;
      }
      ```

      

 * `graphs = g` 

    * **Purpose**: This collection contains an item for each <u>valid</u> SLP transaction (can be GENESIS, MINT, or SEND)

    * **Schema**:

      ```js
      {
        "tokenDetails": { tokenIdHex: string };
        "graphTxn": GraphTxnDetailsDbo;
      }
      ```

      

## Roadmap

### TokenID Filtering

SLPDB will soon include a filtering configuration so that only user specified tokens (or ranges of tokens) will be included or excluded in the SLPDB instance.
