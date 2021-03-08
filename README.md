![SLPDB](assets/slpdb_logo.png)

# SLPDB Readme
**Last Updated:** 2021-01-03

**Current SLPDB Version:** 1.0.0

* 1. [What is SLPDB?](#WhatisSLPDB)
* 2. [Do you need to <u>install</u> SLPDB?](#DoyouneedtouinstalluSLPDB)
* 3. [How do I query for SLP data?](#HowdoIqueryforSLPdata)
	* 3.1. [Working with Large Numbers (`Decimal128` and `BigNumber`)](#WorkingwithLargeNumbersDecimal128andBigNumber)
* 4. [Installation & Setup Instructions](#InstallationInstructions)
	* 4.1. [Prerequisites](#Prerequisites)
	* 4.2. [Full Node Settings for `bitcoin.conf`](#FullNodeSettingsforbitcoin.conf)
    * 4.3. [MongoDB Configuration Settings](#MongoDBConfig)
    * 4.4. [BCHD & gRPC Support](#BCHDgRPCSupport)
	* 4.5. [Testnet Support](#TestnetSupport)
	* 4.6. [Running SLPDB](#RunningSLPDB)
	* 4.7. [Updating SLPDB](#UpdatingSLPDB)
    * 4.8. [Filtering for Specific Token ID](#Filtering)
    * 4.9. [Pruning](#Pruning)
* 5. [Real-time Notifications](#Real-timeNotifications)
	* 5.1. [ZeroMQ (ZMQ)](#ZeroMQZMQ)
    * 5.2. [HTTP Gateways](#HTTPGateways)
* 6. [MongoDB Collections & Data Schema](#MongoDBCollectionsDataSchema)
	* 6.1. [DB Collections](#DBCollections)
* 7. [Test Harnesses](#TestHarnesses)
    * 7.1 [Parser Tests](#ParserTests)
    * 7.2 [Input Tests](#InputTests)
    * 7.3 [Regtest Network Tests](#E2ETests)



##  1. <a name='WhatisSLPDB'></a>What is SLPDB?

SLPDB is an indexer service for storing all data related to the Simple Ledger Protocol with realtime transaction and block notifications.  Users can build block explorers (e.g., https://simpleledger.info), track token burn and mint history, track mint baton status, generate token holder lists at any block height, and easily determine state for script based smart contracts.  Web sites and services can easily create new routes for SLP data when using the [SlpServe](https://github.com/fountainhead-cash/slpserve) and [SlpSockServe](https://github.com/fountainhead-cash/slpsockserve) http gateways.  

SLPDB records all SLP token data, but it can be easily configured to only look at a specified subset of tokens using the token filtering feature.  Filtering for your specific needs can drastically improve realtime notification speed, reduce initial db sync time, and reduce the db footprint.

Live status of nodes running slpdb can be found at: https://status.slpdb.io.



##  2. <a name='DoyouneedtouinstalluSLPDB'></a>Do you need to <u>install</u> SLPDB?

Most likely you do <u>not</u> need to install SLPDB.  Most users will be better off using someone else's publicly shared SLPDB instance like https://slpdb.fountainhead.cash or https://slpdb.bitcoin.com.  You only need to install SLPDB, SlpServe, and/or SlpSockServe if any of the following is true:

- You cannot rely on a third-party for your SLP data.
- The rate limits imposed by `slpdb.fountainhead.cash` or `slpdb.bitcoin.com` are too restrictive for your needs.
- Realtime event notifications available at `slpsocket.fountainhead.cash` are not fast enough for your needs.

NOTE: If you are going to operate your own SLPDB instance you should join the telegram group for help and updates: https://t.me/slpdb



##  3. <a name='HowdoIqueryforSLPdata'></a>How do I query for SLP data?

Queries into SLPDB data are made using [bitquery](https://docs.bitdb.network/docs/query_v3#2-what) which allows MongoDB queries and jq queries over HTTP. Here are some example SLPDB queries:

* Get details of all token IDs ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOiB7fSwKICAgICJwcm9qZWN0IjogeyJ0b2tlbkRldGFpbHMiOiAxLCAidG9rZW5TdGF0cyI6IDEsICJfaWQiOiAwIH0sCiAgICAibGltaXQiOiAxMDAwMAogIH0KfQ==))
* Get token details for single token ID ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsidCJdLAogICAgImZpbmQiOgogICAgewogICAgICAiJHF1ZXJ5IjoKICAgICAgewogICAgICAgICJ0b2tlbkRldGFpbHMudG9rZW5JZEhleCI6ICI5NTlhNjgxOGNiYTVhZjhhYmEzOTFkM2Y3NjQ5ZjVmNmE1Y2ViNmNkY2QyYzJhM2RjYjVkMmZiZmM0YjA4ZTk4IgogICAgICB9CiAgICB9LAogICAgInByb2plY3QiOiB7InRva2VuRGV0YWlscyI6IDEsICJ0b2tlblN0YXRzIjogMSwgIl9pZCI6IDAgfSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=))
* Get addresses for a single token ID ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiZyJdLAogICAgImFnZ3JlZ2F0ZSI6IFsgCiAgICAgICAgeyAiJG1hdGNoIjogewogICAgICAgICAgImdyYXBoVHhuLm91dHB1dHMiOiAKICAgICAgICAgICAgeyAiJGVsZW1NYXRjaCI6IHsKICAgICAgICAgICAgICAic3RhdHVzIjogIlVOU1BFTlQiLCAKICAgICAgICAgICAgICAic2xwQW1vdW50IjogeyAiJGd0ZSI6IDAgfQogICAgICAgICAgICB9CiAgICAgICAgICB9LAogICAgICAgICAgInRva2VuRGV0YWlscy50b2tlbklkSGV4IjogIjk1OWE2ODE4Y2JhNWFmOGFiYTM5MWQzZjc2NDlmNWY2YTVjZWI2Y2RjZDJjMmEzZGNiNWQyZmJmYzRiMDhlOTgiCiAgICAgICAgfQogICAgICB9LAogICAgICAgIHsgIiR1bndpbmQiOiAiJGdyYXBoVHhuLm91dHB1dHMiIH0sCiAgICAgICAgeyAiJG1hdGNoIjogewogICAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cy5zdGF0dXMiOiAiVU5TUEVOVCIsIAogICAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cy5zbHBBbW91bnQiOiB7ICIkZ3RlIjogMCB9LAogICAgICAgICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiOTU5YTY4MThjYmE1YWY4YWJhMzkxZDNmNzY0OWY1ZjZhNWNlYjZjZGNkMmMyYTNkY2I1ZDJmYmZjNGIwOGU5OCIKICAgICAgICAgIH0KICAgICAgICB9LAogICAgICAgIHsgIiRwcm9qZWN0IjogCiAgICAgICAgeyAidG9rZW5fYmFsYW5jZSI6ICIkZ3JhcGhUeG4ub3V0cHV0cy5zbHBBbW91bnQiLAogICAgICAgICAgImFkZHJlc3MiOiAiJGdyYXBoVHhuLm91dHB1dHMuYWRkcmVzcyIsCiAgICAgICAgICAidHhpZCI6ICIkZ3JhcGhUeG4udHhpZCIsIAogICAgICAgICAgInZvdXQiOiAiJGdyYXBoVHhuLm91dHB1dHMudm91dCIsIAogICAgICAgICAgInRva2VuSWQiOiAiJHRva2VuRGV0YWlscy50b2tlbklkSGV4IiB9fSwKICAgICAgeyAiJGdyb3VwIjogeyAiX2lkIjogIiRhZGRyZXNzIiwgInRva2VuX2JhbGFuY2UiOiB7ICIkc3VtIjogIiR0b2tlbl9iYWxhbmNlIiB9fX0KICAgIF0KICB9Cn0=))
* Get token balances for an address ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiZyJdLAogICAgImFnZ3JlZ2F0ZSI6IFsgCiAgICAgICAgeyAiJG1hdGNoIjogewogICAgICAgICAgImdyYXBoVHhuLm91dHB1dHMiOiAKICAgICAgICAgICAgeyAiJGVsZW1NYXRjaCI6IHsKICAgICAgICAgICAgICAiYWRkcmVzcyI6ICJzaW1wbGVsZWRnZXI6cXFzczR6cDgwaG42c3pzYTRqZzJzOWZ1cGU3ZzV0Y2c1dWNkeWwzcjU3IiwgCiAgICAgICAgICAgICAgInN0YXR1cyI6ICJVTlNQRU5UIiwgCiAgICAgICAgICAgICAgInNscEFtb3VudCI6IHsgIiRndGUiOiAwIH0KICAgICAgICAgICAgfQogICAgICAgICAgfQogICAgICAgIH0KICAgICAgfSwgCiAgICAgIHsgIiR1bndpbmQiOiAiJGdyYXBoVHhuLm91dHB1dHMiIH0sCiAgICAgIHsgIiRtYXRjaCI6IHsKICAgICAgICAgICJncmFwaFR4bi5vdXRwdXRzLmFkZHJlc3MiOiAic2ltcGxlbGVkZ2VyOnFxc3M0enA4MGhuNnN6c2E0amcyczlmdXBlN2c1dGNnNXVjZHlsM3I1NyIsCiAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cy5zdGF0dXMiOiAiVU5TUEVOVCIsIAogICAgICAgICAgImdyYXBoVHhuLm91dHB1dHMuc2xwQW1vdW50IjogeyAiJGd0ZSI6IDAgfQogICAgICAgIH0KICAgICAgfSwKICAgICAgeyAiJHByb2plY3QiOiAKICAgICAgICB7ICJhbW91bnQiOiAiJGdyYXBoVHhuLm91dHB1dHMuc2xwQW1vdW50IiwKICAgICAgICAgICJhZGRyZXNzIjogIiRncmFwaFR4bi5vdXRwdXRzLmFkZHJlc3MiLAogICAgICAgICAgInR4aWQiOiAiJGdyYXBoVHhuLnR4aWQiLCAKICAgICAgICAgICJ2b3V0IjogIiRncmFwaFR4bi5vdXRwdXRzLnZvdXQiLCAKICAgICAgICAgICJ0b2tlbklkIjogIiR0b2tlbkRldGFpbHMudG9rZW5JZEhleCIgfX0sCiAgICAgIHsgIiRncm91cCI6IHsgIl9pZCI6ICIkdG9rZW5JZCIsICJhbW91bnQiOiB7ICIkc3VtIjogIiRhbW91bnQiIH0sICJhZGRyZXNzIjogeyIkZmlyc3QiOiAiJGFkZHJlc3MifX19CiAgICBdCiAgfQp9))
* Get utxos for a single token ID ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiZyJdLAogICAgImFnZ3JlZ2F0ZSI6IFsKICAgICAgICB7ICIkbWF0Y2giOiB7CiAgICAgICAgICAidG9rZW5EZXRhaWxzLnRva2VuSWRIZXgiOiAiYzRiMGQ2MjE1NmIzZmE1YzhmMzQzNjA3OWI1Mzk0ZjdlZGMxYmVmNWRjMWNkMmY5ZDBjNGQ0NmY4MmNjYTQ3OSIsCiAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cyI6IAogICAgICAgICAgICB7ICIkZWxlbU1hdGNoIjogewogICAgICAgICAgICAgICJzdGF0dXMiOiAiVU5TUEVOVCIsIAogICAgICAgICAgICAgICJzbHBBbW91bnQiOiB7ICIkZ3RlIjogMCB9CiAgICAgICAgICAgIH0KICAgICAgICAgIH0KICAgICAgICB9CiAgICAgIH0sCiAgICAgIHsgIiR1bndpbmQiOiAiJGdyYXBoVHhuLm91dHB1dHMiIH0sCiAgICAgIHsgIiRtYXRjaCI6IHsKICAgICAgICAgICJncmFwaFR4bi5vdXRwdXRzLnN0YXR1cyI6ICJVTlNQRU5UIiwgCiAgICAgICAgICAiZ3JhcGhUeG4ub3V0cHV0cy5zbHBBbW91bnQiOiB7ICIkZ3RlIjogMCB9CiAgICAgICAgfQogICAgICB9LAogICAgICB7ICIkcHJvamVjdCI6IAogICAgICAgIHsgImFtb3VudCI6ICIkZ3JhcGhUeG4ub3V0cHV0cy5zbHBBbW91bnQiLAogICAgICAgICAgImFkZHJlc3MiOiAiJGdyYXBoVHhuLm91dHB1dHMuYWRkcmVzcyIsCiAgICAgICAgICAidHhpZCI6ICIkZ3JhcGhUeG4udHhpZCIsIAogICAgICAgICAgInZvdXQiOiAiJGdyYXBoVHhuLm91dHB1dHMudm91dCIsIAogICAgICAgICAgInRva2VuSWQiOiAiJHRva2VuRGV0YWlscy50b2tlbklkSGV4IiB9CiAgICAgIH0KICAgIF0sCiAgICAibGltaXQiOiAxMDAwMDAKICB9Cn0=))
* Get transaction history by token ID ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6CiAgICB7CiAgICAgICIkcXVlcnkiOgogICAgICB7CiAgICAgICAgInNscC5kZXRhaWwudG9rZW5JZEhleCI6ICI0OTUzMjJiMzdkNmIyZWFlODFmMDQ1ZWRhNjEyYjk1ODcwYTBjMmI2MDY5YzU4ZjcwY2Y4ZWY0ZTZhOWZkNDNhIgogICAgICB9LAogICAgICAiJG9yZGVyYnkiOgogICAgICB7CiAgICAgICAgImJsay5pIjogLTEKICAgICAgfQogICAgfSwKICAgICJsaW1pdCI6IDEwMAogIH0sCiAgInIiOiB7CiAgICAiZiI6ICJbLltdIHwgeyB0eGlkOiAudHguaCwgdG9rZW5EZXRhaWxzOiAuc2xwIH0gXSIKICB9Cn0=))
* Get transaction history by address ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6CiAgICB7CiAgICAgICIkb3IiOgogICAgICBbCiAgICAgICAgewogICAgICAgICAgImluLmUuYSI6ICJzaW1wbGVsZWRnZXI6cXJodmN5NXhsZWdzODU4ZmpxZjhzc2w2YTRmN3dwc3RhcW50MHdhdXd1IgogICAgICAgIH0sCiAgICAgICAgewogICAgICAgICAgIm91dC5lLmEiOiAic2ltcGxlbGVkZ2VyOnFyaHZjeTV4bGVnczg1OGZqcWY4c3NsNmE0Zjd3cHN0YXFudDB3YXV3dSIKICAgICAgICB9CiAgICAgIF0KICAgIH0sCiAgICAic29ydCI6CiAgICB7CiAgICAgICJibGsuaSI6IC0xCiAgICB9LAogICAgImxpbWl0IjogMTAwCiAgfSwKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7IHR4aWQ6IC50eC5oLCB0b2tlbkRldGFpbHM6IC5zbHAsIGJsazogLmJsayB9IF0iCiAgfQp9))
* Get transaction history by address and token ID ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6CiAgICB7CiAgICAiJG9yIjoKICAgIFsKICAgICAgewogICAgICAgICJpbi5lLmEiOiAic2ltcGxlbGVkZ2VyOnFyaHZjeTV4bGVnczg1OGZqcWY4c3NsNmE0Zjd3cHN0YXFudDB3YXV3dSIKICAgICAgfSwKICAgICAgewogICAgICAgICJvdXQuZS5hIjogInNpbXBsZWxlZGdlcjpxcmh2Y3k1eGxlZ3M4NThmanFmOHNzbDZhNGY3d3BzdGFxbnQwd2F1d3UiCiAgICAgIH0KICAgIF0sCiAgICAic2xwLmRldGFpbC50b2tlbklkSGV4IjogIjQ5NTMyMmIzN2Q2YjJlYWU4MWYwNDVlZGE2MTJiOTU4NzBhMGMyYjYwNjljNThmNzBjZjhlZjRlNmE5ZmQ0M2EiCiAgICB9LAogICAgInNvcnQiOgogICAgewogICAgICAiYmxrLmkiOiAtMQogICAgfSwKICAgICJsaW1pdCI6IDEwMAogIH0sCiAgInIiOiB7CiAgICAiZiI6ICJbLltdIHwgeyB0eGlkOiAudHguaCwgdG9rZW5EZXRhaWxzOiAuc2xwIH0gXSIKICB9Cn0=))
* Get all invalid token transactions (w/ SLP op_return) ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiYyIsICJ1Il0sCiAgICAiZmluZCI6IHsKICAgICAgInNscC52YWxpZCI6IGZhbHNlCiAgICB9LAogICAgImxpbWl0IjogMTAwMDAsCiAgICAicHJvamVjdCI6IHsidHguaCI6IDF9CiAgfSwKICAiciI6IHsKICAgICJmIjogIlsuW10gfCB7dHhpZDogLnR4Lmh9XSIKICB9Cn0=))
* Get transaction counts for each token (w/ time range) ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IAogIHsiYWdncmVnYXRlIjoKICBbeyIkbWF0Y2giOnsiYmxrLnQiOnsgIiRndGUiOiAxNTUyODY3MjAwLCAiJGx0ZSI6IDE1NTI5NTM2MDB9fX0sCiAgeyIkZ3JvdXAiOnsiX2lkIjogIiRzbHAuZGV0YWlsLm5hbWUiLCAiY291bnQiOiB7IiRzdW0iOiAxfX19XSwibGltaXQiOjEwMH19))
* Get SLP usage per day (w/ time range) ([example](https://slpdb.fountainhead.cash/explorer/eyJ2IjozLCJxIjp7ImRiIjpbImMiXSwiYWdncmVnYXRlIjpbeyIkbWF0Y2giOnsic2xwLnZhbGlkIjp0cnVlLCJibGsudCI6eyIkZ3RlIjoxNTQzMTcyNTY4LjIwOCwiJGx0ZSI6MTU1MzU0MDU2OC4yMDh9fX0seyIkZ3JvdXAiOnsiX2lkIjoiJGJsay50IiwiY291bnQiOnsiJHN1bSI6MX19fV0sImxpbWl0IjoxMDAwMH0sInIiOnsiZiI6IlsgLltdIHwge2Jsb2NrX2Vwb2NoOiAuX2lkLCB0eHM6IC5jb3VudH0gXSJ9fQ==))
* List input/output amount total for each valid transaction ([example](https://slpdb.fountainhead.cash/explorer/ewogICJ2IjogMywKICAicSI6IHsKICAgICJkYiI6IFsiZyJdLAogICAgImFnZ3JlZ2F0ZSI6IFsgCiAgICAgIHsgIiRwcm9qZWN0Ijp7ICJncmFwaFR4bi50eGlkIjogMSwgImdyYXBoVHhuLmRldGFpbHMudHJhbnNhY3Rpb25UeXBlIjogMSwgImlucHV0VG90YWwiOiB7ICIkc3VtIjoiJGdyYXBoVHhuLmlucHV0cy5zbHBBbW91bnQiIH0sICJvdXRwdXRUb3RhbCI6IHsiJHN1bSI6IiRncmFwaFR4bi5vdXRwdXRzLnNscEFtb3VudCJ9IH19XSwKICAgICJsaW1pdCI6IDEwMDAKICB9Cn0=))

Users should utilize the [SlpServe](https://github.com/fountainhead-cash/slpserve) and [SlpSockServer](https://github.com/fountainhead-cash/slpsockserve) projects in order to conveniently query for the SLP data produced by SLPDB.


###  3.1. <a name='WorkingwithLargeNumbersDecimal128andBigNumber'></a>Working with Large Numbers (`Decimal128` and `BigNumber`)

Some of the values used in SLP require 64 or more bits of precision, which is more precision than `number` type can provide. To ensure value precision is maintained values are stored in collections using the `Decimal128` type.  `Decimal128` allows users to make database queries using query comparison operators like `$gte`.  

The services `SlpServe` and `SlpSockServer` return query results as a JSON object with `Decimal128` values converted to `string` type so that readability is improved for the query consumer, as opposed to being returned as an awkward `$DecimalNumber` JSON object.  The `string` type also maintains the original value precision.  If a user wants to perform math operations on these `string` values the user will need to first convert them to a large number type like `BigNumber` or `Decimal128` (e.g., `Decimal128.fromString("1000.123124")` or using [bignumber.js](https://github.com/MikeMcl/bignumber.js/) npm library via `new BigNumber("1000.00000001")`).



##  4. <a name='InstallationInstructions'></a>Installation Instructions

###  4.1. <a name='Prerequisites'></a>Prerequisites
* Node.js 12
* MongoDB 4.4+
* Bitcoin Cash Node, BitcoinUnlimited, BCHD, or other Bitcoin Cash full node with:
  * RPC-JSON (or gRPC) and 
  * ZeroMQ event notifications

###  4.2. <a name='FullNodeSettingsforbitcoin.conf'></a>Full Node Settings for `bitcoin.conf`

The following settings should be applied to your full node's configuration.  NOTE: The settings presented here are matched up with the default settings presented in `config.ts`, you should modify these settings and use environment variables (shown in `config.ts`) if you need a custom setup.
* `txindex=1`
* `server=1`
* `rpcuser=bitcoin`
* `rpcpassword=password`
* `rpcport=8332`
* `rpcworkqueue=10000`
* `rpcthreads=8`
* `zmqpubhashtx=tcp://*:28332`
* `zmqpubrawtx=tcp://*:28332`
* `zmqpubhashblock=tcp://*:28332`
* `zmqpubrawblock=tcp://*:28332`
* Optional: `testnet=1`

###  4.3. <a name='MongoDBConfig'></a>MongoDB Configuration Settings

MongoDB will take up a large amount of memory and completely fill up a system with 16GB ram.  To prevent this from happening you should set a limit on the WiredTiger maximum cache limit.  Refer to MongoDB documentation for information on how to configure your specific version of MongoDB.  On a linux based system add `wiredTigerCacheSizeGB=2` to `/etc/mongodb.conf`.

###  4.4. <a name='BCHDgRPCSupport'></a>BCHD & gRPC Support

High speed gRPC is supported with BCHD 0.15.2+ full nodes in place of JSON RPC and incoming ZMQ notifications.  To enable, add the environment variables `grpc_url` and `grpc_certPath`.  See the `example.env` file in this project and the [BCHD documentation](https://github.com/gcash/bchd/tree/master/docs) for more details.  For instructions on installing a self-signed certificate see guidance [here](https://github.com/simpleledgerinc/grpc-bchrpc-node#connecting-to-local-bchd).

###  4.5. <a name='TestnetSupport'></a>Testnet Support

To use SLPDB with Testnet simply set your full node to the testnet network (e.g., set `testnet=1` within `bitcoin.conf`) and SLPDB will automatically instantiate using proper databases names according to the network.  For informational purposes the database names are as follows:
* **Mainnet**
  * Mongo db name = `slpdb`
  * LevelDB directory = `./_leveldb`
* **Testnet**
  * Mongo db name = `slpdb_testnet`
  * Testnet diectory = `./_leveldb_testnet`

###  4.6. <a name='RunningSLPDB'></a>Running SLPDB

**1)** Run MongoDB (`config.ts` default port is 27017)

**2)** Run Bitcoin Cash full node using `bitcoin.conf` settings from above.
* [Bitcoin Cash Node](https://bitcoincashnode.org)
* [BitcoinBU](https://www.bitcoinunlimited.info)

**3)** Install SLPDB dependencies using `npm install` at the command-line

**4)** Start SLPDB using `npm start` at the command-line and wait for sync process to complete (monitor status in the console).

* SLPDB will need to crawl the blockchain to save all *previous* SLP transaction data to MongoDB

* After crawling SLPDB will build token graphs for each token using either the raw transaction data or a previously saved token graph state.

**5)** Install and run [slpserve](https://github.com/fountainhead-cash/slpserve) and/or [slpsocket](https://github.com/simpleledger/sockserve) to access SLP token data and statistics

###  4.7. <a name='UpdatingSLPDB'></a>Updating SLPDB

**1)** Execute `git pull origin master` to update to latest version.

**2)** Execute `npm install` to update packages

**3)** Execute `npm run migrate up` to run latest migrations.

**4)** Restart SLPDB.

### 4.8. <a name='Filtering'></a>Filtering SLPDB to specific Token IDs

Modify the `example-filters.yml` file to suit your needs and then rename it as `filters.yml` to activate the filtering.  Currently, `include-single` is the only filter type available, reference the example file for useage requirements.

### 4.9. <a name='Pruning'></a>Pruning

Pruning removes totally spent and aged transactions from the global transaction cache, the token graph, and the validator cache.  Pruning occurs after a transaction has been totally spent and is aged more than 10 blocks.  At this time there is no custom configuration available for pruning.



##  5. <a name='Real-timeNotifications'></a>Real-time Notifications

###  5.1. <a name='ZeroMQZMQ'></a>ZeroMQ (ZMQ)

SLPDB publishes the following notifications via [ZMQ](http://zeromq.org/intro:read-the-manual) and can be subscribed to by binding to http://0.0.0.0:28339.  The following events can be subscribed to:
* `mempool`
* `block`

Each notification is published in the following data format:

```js
{
    "tx": {
        h: string; 
    };
    "in": Xput[];
    "out": Xput[];
    "blk": { 
        h: string; 
        i: number; 
        t: number; 
    };
    "slp": {
        valid: boolean|null;
        detail: {
            transactionType: SlpTransactionType;
            tokenIdHex: string;
            versionType: number;
            symbol: string;
            name: string;
            documentUri: string; 
            documentSha256Hex: string|null;
            decimals: number;
            txnContainsBaton: boolean;
            txnBatonVout: number|null;
        } | null;
        outputs: { address: string|null, amount: Decimal128|null }[]|null;|null;
        invalidReason: string|null;
        schema_version: number;
    };
}
```

### 5.2 <a name='HTTPGateways'></a>HTTP Gateways

Realtime SLP notifications can be accessed via HTTP server-sent events (SSE) by utilizing [SlpSocketServe](https://github.com/fountainhead-cash/slpsockserve).  A good alternative to SLPDB based realtime notifications is [SlpStream](https://github.com/blockparty-sh/slpstream) which utilizes the gs++ backend.



##  6. <a name='MongoDBCollectionsDataSchema'></a>MongoDB Collections & Data Schema

Three categories of information are stored in MongoDB:

1. Valid and invalid SLP token transactions,  
2. Statistical calculations about each token, and 
3. Token graph state 

###  6.1. <a name='DBCollections'></a>DB Collections

Four MongoDB collections used to store these three categories of data, they are as follows:

 * `confirmed = c`  and `unconfirmed = u` 

    * **Purpose**: These two collections include any Bitcoin Cash transaction containing the "SLP" Lokad ID and passes all filters set in `filters.yml`.  The collection used depends on the transaction's confirmation status . Both valid and invalid SLP transactions are included.  Whenever new SLP transactions are added to the Bitcoin Cash network they are immediately added to one of these collections.

    * **Schema**:

    ```js
    {
        "tx": {
            h: string; 
        };
        "in": Xput[];
        "out": Xput[];
        "blk": { 
            h: string; 
            i: number; 
            t: number; 
        };
        "slp": {
            valid: boolean|null;
            detail: {
                transactionType: SlpTransactionType;
                tokenIdHex: string;
                versionType: number;
                symbol: string;
                name: string;
                documentUri: string; 
                documentSha256Hex: string|null;
                decimals: number;
                txnContainsBaton: boolean;
                txnBatonVout: number|null;
            } | null;
            invalidReason: string|null;
            schema_version: number;
        };
    }
    ```

      

 * `tokens = t` 

    * **Purpose**: This collection includes metadata and statistics about each token.  Each time SLPDB has finished updating a token graph the associated items in this collection are updated.

    * **Schema**:

	```js
    {
        "tokenDetails": {
            transactionType: SlpTransactionType;
            tokenIdHex: string;
            versionType: number;
            timestamp: string|null;
            timestamp_unix: number|null;
            symbol: string;
            name: string;
            documentUri: string; 
            documentSha256Hex: string|null;
            decimals: number;
            containsBaton: boolean;
            batonVout: number|null;
            genesisOrMintQuantity: Decimal128|null;
            sendOutputs: Decimal128[]|null;
        };
        "tokenStats": {
            block_created: number|null;
            approx_txns_since_genesis: number;
        }
        "pruningState": TokenPruneStateDbo;
        "mintBatonUtxo": string;
        "mintBatonStatus": TokenBatonStatus;
        "lastUpdatedBlock": number;
        "schema_version": number;
        "nftParentId?": string;
    }
	```



 * `graphs = g` 

    * **Purpose**: This collection contains an item for each <u>valid</u> SLP transaction (can be GENESIS, MINT, or SEND)

    * **Schema**:

	```js
    {
        "tokenDetails": { 
            tokenIdHex: string 
        };
        "graphTxn": {
            txid: string;
            details: SlpTransactionDetailsDbo;
            outputs: GraphTxnOutputDbo[];
            inputs: GraphTxnInputDbo[];
            _blockHash: Buffer | null;
            _pruneHeight: number | null;
        };
    }
	```



## 7. <a name='TestHarnesses'></a>Test Harnesses

SLPDB is backed by three distinct test harnesses, they include (1) OP_RETURN message parsing unit tests and differential fuzzing, (2) graph input unit tests, and (3) end-to-end regression testing.

###  7.1. <a name='ParserTests'></a>Parser Tests

SLPDB leverages the SLPJS npm library has been tested using differential fuzzing and passes all SLP message parser unit tests for Token Type 1 and NFT1.  You can learn more about this testing at the following locations:
* [SLP Unit Tests - Parsing of OP_RETURN scripts](https://github.com/simpleledger/slp-unit-test-data#part-a-parsing-of-op_return-scripts)
* [JS Fuzzer](https://github.com/simpleledger/slp-validate/tree/master/fuzzer)
* [c++ fuzzers](https://github.com/blockparty-sh/cpp_slp_graph_search/tree/master/fuzz)

###  7.2. <a name='InputTests'></a>Input Tests

Graph validation typically requires checking that a transactions's valid inputs the outputs specified in the SLP OP_RETURN message. 
The SLPJS npm library also passes all unit tests which test for the specified input requirements for Token Type 1 and NFT1, and you can learn more about these types of tests at the following location:
* [SLP Unit Tests - Transaction input tests](https://github.com/simpleledger/slp-unit-test-data#part-b-transaction-input-tests)

###  7.3. <a name='E2ETests'></a>End-to-End Tests

A set of end-to-end tests have been created in order to ensure the expected behavior of SLPDB utilizing the bitcoin regtest network.  These tests simulate actual transaction activity using the bitcoin regtest test network and check for proper state in mongoDB and also check that zmq notifications are emitted.  The `tests` directory contains the end-to-end tests which can be run by following the instructions provided in the `regtest` directory.
