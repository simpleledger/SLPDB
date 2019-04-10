![SLPDB](assets/slpdb_logo.png)

# SLPDB Readme
**Last Updated:** 2019-04-10

**Current SLPDB Version:** 0.9.9 (beta)



## Introduction

SLPDB is a node.js application that stores all token data for the Simple Ledger Protocol.  SLPDB requires MongoDB and a Bitcoin Cash full node to fetch, listen for, and store SLP data.  The application allows other processes to subscribe to real-time SLP events via ZeroMQ.  However, it is recommended that end users utilize the [SlpServe](https://github.com/fountainhead-cash/slpserve) and [SlpSockServer](https://github.com/fountainhead-cash/slpsockserve) projects in order to conveniently access the SLP data produced by SLPDB.

SLPDB enables access to useful SLP data:

* List all token details and usage information [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgeyB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* List all tokens as a summary of token supply [example](http://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOnsgICAKICAgICAgInRva2VuU3RhdHMubWludGluZ19iYXRvbl9zdGF0dXMiOiAiQUxJVkUiCiAgICB9LAogICAgInByb2plY3QiOiB7CiAgICAgICJ0b2tlbkRldGFpbHMudG9rZW5JZEhleCI6IDEsCiAgICAgICJ0b2tlblN0YXRzLnF0eV90b2tlbl9taW50ZWQiOiAxLAogICAgICAidG9rZW5TdGF0cy5xdHlfdG9rZW5fYnVybmVkIjogMSwKICAgICAgInRva2VuU3RhdHMucXR5X3Rva2VuX2NpcmN1bGF0aW5nX3N1cHBseSI6MQogICAgfSwKICAgICJzb3J0IjogeyAidG9rZW5TdGF0cy5xdHlfdG9rZW5fY2lyY3VsYXRpbmdfc3VwcGx5IjogLTEgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9LAogICJyIjogewogICAgImYiOiAiWy5bXSB8IHt0b2tlbklkOiAudG9rZW5EZXRhaWxzLnRva2VuSWRIZXgsIG1pbnRlZDogLnRva2VuU3RhdHMucXR5X3Rva2VuX21pbnRlZCwgIGJ1cm5lZDogLnRva2VuU3RhdHMucXR5X3Rva2VuX2J1cm5lZCwgIGNpcmN1bGF0aW5nOiAudG9rZW5TdGF0cy5xdHlfdG9rZW5fY2lyY3VsYXRpbmdfc3VwcGx5fV0iCiAgfQp9)
* List all tokens sorted by burn amount [example](http://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgCiAgICAiZmluZCI6CiAgICB7CiAgICAgICIkcXVlcnkiOiB7CiAgICAgICAgIiRhbmQiOiBbewogICAgICAgICAgInRva2VuU3RhdHMubWludGluZ19iYXRvbl9zdGF0dXMiOiAiQUxJVkUiCiAgICAgICAgfSwKICAgICAgICB7CiAgICAgICAgICAidG9rZW5TdGF0cy5xdHlfdG9rZW5fYnVybmVkIjogeyAiJGd0ZSI6IDEgfQogICAgICAgIH1dCiAgICAgIH0KICAgIH0sCiAgICAicHJvamVjdCI6IHsKICAgICAgInRva2VuRGV0YWlscy50b2tlbklkSGV4IjogMSwgInRva2VuU3RhdHMucXR5X3Rva2VuX21pbnRlZCI6IDEsICJ0b2tlblN0YXRzLnF0eV90b2tlbl9idXJuZWQiOiAxLCAidG9rZW5TdGF0cy5xdHlfdG9rZW5fY2lyY3VsYXRpbmdfc3VwcGx5IjogMQogICAgfSwKICAgICJzb3J0IjogeyAidG9rZW5TdGF0cy5xdHlfdG9rZW5fYnVybmVkIjogLTEgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* Token details and usage information by token ID [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgewogICAgICAgICJ0b2tlbkRldGFpbHMudG9rZW5JZEhleCI6ICI5NTlhNjgxOGNiYTVhZjhhYmEzOTFkM2Y3NjQ5ZjVmNmE1Y2ViNmNkY2QyYzJhM2RjYjVkMmZiZmM0YjA4ZTk4IgogICAgICB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=)
* List all address balances by token ID [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJmaW5kIjogewogICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIsCiAgICAgICJ0b2tlbl9iYWxhbmNlIjogeyAiJGd0ZSI6IDAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAwMCwKICAgICJwcm9qZWN0IjogeyJhZGRyZXNzIjogMSwgInNhdG9zaGlzX2JhbGFuY2UiOiAxLCAidG9rZW5fYmFsYW5jZSI6IDEsICJfaWQiOiAwIH0KICB9Cn0=)
* List all token balances by address [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYSJdLCAKICAgICJmaW5kIjogewogICAgICAiYWRkcmVzcyI6ICJzaW1wbGVsZWRnZXI6cXJkbDBoZWswd3ltZHV4a3k0bHFxMzd1am1lODIyYWc5eTBoejJ3dnFxIiwKICAgICAgInRva2VuX2JhbGFuY2UiOiB7ICIkZ3RlIjogMCB9CiAgICB9LAogICAgImxpbWl0IjogMTAwMDAKICB9LCAKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHRva2VuSWQ6IC50b2tlbkRldGFpbHMudG9rZW5JZEhleCwgc2F0b3NoaXNfYmFsYW5jZTogLnNhdG9zaGlzX2JhbGFuY2UsIHRva2VuX2JhbGFuY2U6IC50b2tlbl9iYWxhbmNlIH1dIgogIH0KfQ==)
* List all token utxos by token ID [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsieCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjogeyAKICAgICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIgCiAgICAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAwCiAgfSwKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHRva2VuSWQ6IC50b2tlbkRldGFpbHMudG9rZW5JZEhleCwgdXR4bzogLnV0eG8gfV0iCiAgfQp9)
* List transaction history by token ID [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJmaW5kIjoKICAgIHsKICAgICAgImRiIjogWyJjIiwgInUiXSwKICAgICAgIiRxdWVyeSI6CiAgICAgIHsKICAgICAgICAic2xwLmRldGFpbC50b2tlbklkSGV4IjogIjQ5NTMyMmIzN2Q2YjJlYWU4MWYwNDVlZGE2MTJiOTU4NzBhMGMyYjYwNjljNThmNzBjZjhlZjRlNmE5ZmQ0M2EiCiAgICAgIH0sCiAgICAgICIkb3JkZXJieSI6CiAgICAgIHsKICAgICAgICAiYmxrLmkiOiAtMQogICAgICB9CiAgICB9LAogICAgImxpbWl0IjogMTAwCiAgfSwKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHR4aWQ6IC50eC5oLCB0b2tlbkRldGFpbHM6IC5zbHAgfSBdIgogIH0KfQ==)
* List transaction history by address [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJmaW5kIjoKICAgIHsKICAgICAgImRiIjogWyJjIiwgInUiXSwKICAgICAgIiRxdWVyeSI6CiAgICAgIHsKICAgICAgICAiJG9yIjoKICAgICAgICBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJpbi5lLmEiOiAicXJodmN5NXhsZWdzODU4ZmpxZjhzc2w2YTRmN3dwc3RhcWxzeTRndXN6IgogICAgICAgICAgfSwKICAgICAgICAgIHsKICAgICAgICAgICAgIm91dC5lLmEiOiAicXJodmN5NXhsZWdzODU4ZmpxZjhzc2w2YTRmN3dwc3RhcWxzeTRndXN6IgogICAgICAgICAgfQogICAgICAgIF0KICAgICAgfSwKICAgICAgIiRvcmRlcmJ5IjoKICAgICAgewogICAgICAgICJibGsuaSI6IC0xCiAgICAgIH0KICAgIH0sCiAgICAibGltaXQiOiAxMDAKICB9LAogICJyIjogewogICAgImYiOiAiWy5bXSB8IHsgdHhpZDogLnR4LmgsIHRva2VuRGV0YWlsczogLnNscCB9IF0iCiAgfQp9)
* List transaction history by address and token ID [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJmaW5kIjoKICAgIHsKICAgICAgImRiIjogWyJjIiwgInUiXSwKICAgICAgIiRxdWVyeSI6CiAgICAgIHsKICAgICAgICAiJG9yIjoKICAgICAgICBbCiAgICAgICAgICB7CiAgICAgICAgICAgICJpbi5lLmEiOiAicXJodmN5NXhsZWdzODU4ZmpxZjhzc2w2YTRmN3dwc3RhcWxzeTRndXN6IgogICAgICAgICAgfSwKICAgICAgICAgIHsKICAgICAgICAgICAgIm91dC5lLmEiOiAicXJodmN5NXhsZWdzODU4ZmpxZjhzc2w2YTRmN3dwc3RhcWxzeTRndXN6IgogICAgICAgICAgfQogICAgICAgIF0sCiAgICAgICAgInNscC5kZXRhaWwudG9rZW5JZEhleCI6ICI0OTUzMjJiMzdkNmIyZWFlODFmMDQ1ZWRhNjEyYjk1ODcwYTBjMmI2MDY5YzU4ZjcwY2Y4ZWY0ZTZhOWZkNDNhIgogICAgICB9LAogICAgICAiJG9yZGVyYnkiOgogICAgICB7CiAgICAgICAgImJsay5pIjogLTEKICAgICAgfQogICAgfSwKICAgICJsaW1pdCI6IDEwMAogIH0sCiAgInIiOiB7CiAgICAiZiI6ICJbLltdIHwgeyB0eGlkOiAudHguaCwgdG9rZW5EZXRhaWxzOiAuc2xwIH0gXSIKICB9Cn0=)
* Show invalid token transactions [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6IHsKICAgICAgInNscC52YWxpZCI6IGZhbHNlCiAgICB9LAogICAgImxpbWl0IjogMzAwLAogICAgInByb2plY3QiOiB7InR4LmgiOiAxfQogIH0sCiAgInIiOiB7CiAgICAiZiI6ICJbLltdIHwge3R4aWQ6IC50eC5ofV0iCiAgfQp9)
* List transaction counts for each token [example](https://slpdb.bitcoin.com/explorer2/ewogICJ2IjogMywKICAicSI6IAogIHsiYWdncmVnYXRlIjoKICBbeyIkbWF0Y2giOnsiYmxrLnQiOnsgIiRndGUiOiAxNTUyODY3MjAwLCAiJGx0ZSI6IDE1NTI5NTM2MDB9fX0sCiAgeyIkZ3JvdXAiOnsiX2lkIjogIiRzbHAuZGV0YWlsLm5hbWUiLCAiY291bnQiOiB7IiRzdW0iOiAxfX19XSwibGltaXQiOjEwMH19)
* List SLP usage per day [example](https://slpdb.bitcoin.com/explorer2/eyJ2IjozLCJxIjp7ImRiIjpbImMiXSwiYWdncmVnYXRlIjpbeyIkbWF0Y2giOnsic2xwLnZhbGlkIjp0cnVlLCJibGsudCI6eyIkZ3RlIjoxNTQzMTcyNTY4LjIwOCwiJGx0ZSI6MTU1MzU0MDU2OC4yMDh9fX0seyIkZ3JvdXAiOnsiX2lkIjoiJGJsay50IiwiY291bnQiOnsiJHN1bSI6MX19fV0sImxpbWl0IjoxMDAwMH0sInIiOnsiZiI6IlsgLltdIHwge2Jsb2NrX2Vwb2NoOiAuX2lkLCB0eHM6IC5jb3VudH0gXSJ9fQ==)

You only need to install SLPDB, SlpServe, and/or SlpSockServe projects if any of the following is true:
* You cannot rely on a third-party for your SLP data.
* SLP data query API offered at `slpdb.bitcoin.com` does not meet your needs.
* Realtime SLP data event notifications available at `slpsocket.fountainhead.cash` does not meet your needs.

NOTE: If you are going to operate a SLPDB instance you should join the telegram group for help and updates: https://t.me/slpdb

## Installation

### Prerequisites
* Node.js 8.15+
* MongoDB 4.0+
* BCHD (recommended with "fastsync"), BitcoinABC, BitcoinUnlimited or other Bitcoin Cash full node with:
  * RPC-JSON and 
  * ZeroMQ event notifications

### Full Node Settings — `bitcoin.conf`

The following settings should be applied to your full node's configuration.  NOTE: The settings presented here are matched up with the default settings presented in `config.ts`, you should modify these settings and use environment variables (shown in `config.ts`) if you need a custom setup.
* `server=1`
* `rpcuser=bitcoin`
* `rpcpassword=password`
* `rpcport=8332`
* `rpcworkqueue=10000`
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
* [BCHD](https://github.com/gcash/bchd) (recommended with `--fastsync`)
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
  * `qty_token_minted` - Total token quantity created in GENESIS and MINT transactions 
  * `qty_token_burned` - Total token quantity burned in invalid SLP transactions or in transactions having lower token outputs than inputs.
  * `qty_token_circulating_supply` - Total quantity of tokens circulating (i.e., Genesis + Minting - Burned = Circulating Supply).
  * `minting_baton_status`  - State of the minting baton (possible baton status: `ALIVE`, `NEVER_CREATED`, `DEAD_BURNED`, or `DEAD_ENDED`).
  * `mint_baton_address (NOT YET IMPLEMENTED)` - Address holding the minting baton or last address to hold.
  * `mint_baton_txid (NOT YET IMPLEMENTED)` - TXID where the minting baton exists or existed before being destroyed.

### Summarized Usage Stats
  * `qty_valid_txns_since_genesis` - Number of valid SLP transactions made since Genesis (Includes GENESIS, SEND and MINT transactions)
  * `qty_valid_token_utxos` - Number of current unspent & valid SLP UTXOs
  * `qty_valid_token_addresses` - Number of unique address holders
  * `qty_satoshis_locked_up` - Quantity of BCH that is locked up in SLP UTXOs
  * `block_last_active_mint` - The block containing the token's MINT transaction
  * `block_last_active_send` - The block containing the token's SEND transaction
  * `block_created` - The block containing the token's GENESIS transaction
  * `block_last_burn (NOT YET IMPLEMENTED)` - The block containing the last burn event

### Supply Event Stats
  * `events_mint (NOT YET IMPLEMENTED)` - Events when the minting baton was moved and new tokens were created
  * `events_burn (NOT YET IMPLEMENTED)` - Events when tokens were burned (possible type of burn: `OUTS_LESS_THAN_INS` or `UTXO_DESTROYED`)



## Real-time Notifications

### ZeroMQ (ZMQ)

SLPDB publishes the following notifications via [ZMQ](http://zeromq.org/intro:read-the-manual) and can be subscribed to by binding to http://0.0.0.0:28339.  The following events can be subscribed to:
* `mempool`
* `block`

Each notification is published in the following data format:

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



## MongoDB Collections & Data Schema

Three categories of information are stored in MongoDB:

1. Valid and invalid SLP token transactions,  
2. Statistical calculations about each token, and 
3. Token graph state 


### Use of Decimal128 and Large Numbers

Some of the values used in SLP require 64 or more bits of precision, which is more precision than `number` type can provide. To ensure value precision is maintained values are stored in collections using the `Decimal128` type.  `Decimal128` allows users to make database queries using query comparison operators like `$gte`.  

However, when using `SlpServe` to return query results as a JSON object these `Decimal128` values are converted into `string` type to improve readability of the value by the consumer, as opposed to being returned as a special `$DecimalNumber` JSON object.  The `string` type also maintains the original value precision, but this means that if a query consumer using `SlpServe` wanting to perform math operations on these values will need to convert them to a big number type like `BigNumber` or `Decimal128` (e.g., `Decimal128.fromString("1000.123124")` or using "bignumber.js" npm library via `new BigNumber("1000.00000001")`).

### DB Collections

Six MongoDB collections used to store these three categories of data, they are as follows:

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
	    "tokenStats":     
	        "block_created": number|null;
	        "block_last_active_send": number|null;
	        "block_last_active_mint": number|null;
	        "qty_valid_txns_since_genesis": number;
	        "qty_valid_token_utxos": number;
	        "qty_valid_token_addresses": number;
	        "qty_token_minted": Decimal128;
	        "qty_token_burned": Decimal128;
	        "qty_token_circulating_supply": Decimal128;
	        "qty_satoshis_locked_up": number;
	        "minting_baton_status": TokenBatonStatus;
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

      

## Future Updates & Features

### TokenID Filtering

SLPDB will soon include a filtering configuration so that only user specified tokens (or ranges of tokens) will be included or excluded in the SLPDB instance.

### Make compatible with other Lokad IDs

We want to make SLPDB more easily forkable for other OP_RETURN projects which may be unrelated to SLP tokens.