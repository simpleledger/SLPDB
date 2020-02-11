## Regtest Network for End-to-End testing

To get started with unit tests you need to startup the sandboxed bitcoin regtest network described in `docker-compose.yml`.  This will creates a network of bitcoin nodes which will connect to a locally running SLPDB instance outside of the docker container.

Start the regtest network:
```
$ git apply ./patches/*
$ cp .env.regtest .env
$ cd regtest
$ docker-compose up -d
$ docker logs -f regtest_slpdb_1  # this is optional
```

Next, run the e2e tests located in the `test` folder using:

```
$ npm test
```



### Optional: Setting up mongoDB replica set for testing
1. Uncomment mongo entrypoint/volume lines in `docker-compose.yml`
2. Delete `regtest/mongo/db` and `regtest/mongo/configdb` directories
3. Run `docker-compose up -d`
4. Run `docker exec -it regtest_mongo_1 mongo`
5. Run `rs.initiate()`
6. Run `rs.status()` to make sure `ok: 1`
7. Run `cfg = rs.config()`
8. Run `cfg.members[0].host = "localhost:27017"`
9. Run `cfg.reconfig(cfg, {force:true})`
