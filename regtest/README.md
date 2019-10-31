## Regression test network w/ docker

1. ``
2. ``
3. ``

### Reseting mongoDB from scratch
1. Delete `./mongo/db` and `./mongo/configdb` directories
2. Run `docker-compose up -d`
3. Run `docker exec -it regtest_mongo_1 mongo`
4. Run `rs.initiate()`
5. Run `rs.status()` to make sure `ok: 1`
6. Run `cfg = rs.config()`
7. Run `cfg.members[0].host = "localhost:27017"`
8. Run `cfg.reconfig(cfg, {force:true})`
