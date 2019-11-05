## regtest network

To get started with unit tests you need to startup the sandboxed bitcoin regtest network described in `docker-compose.yml`.  This will creates a network of bitcoin nodes with one of the nodes connected to SLPDB.

Start the test network:
```
$ cd regtest
$ docker-compose up -d
$ docker logs -f regtest_slpdb_1
```

Run the unit tests:

```
$ npm test
```



### Creating Unit Tests

Take a look at the tests in the `test` directory for guidance on how to create unit tests.



<!-- ### Setting up mongoDB from scratch as a replica set
1. Delete `regtest/mongo/db` and `regtest/mongo/configdb` directories
2. Run `docker-compose up -d`
3. Run `docker exec -it regtest_mongo_1 mongo`
4. Run `rs.initiate()`
5. Run `rs.status()` to make sure `ok: 1`
6. Run `cfg = rs.config()`
7. Run `cfg.members[0].host = "localhost:27017"`
8. Run `cfg.reconfig(cfg, {force:true})` -->
