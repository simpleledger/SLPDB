## MongoDB Dev Environment Setup

Utilizing multi-document transactions with mongodb requires deployment of a replica set.  For a development environment and perhaps even production this is simple to setup, but it does require the following steps:

1. Start mongod with `--replSet <rs-name>`, where `<rs-name>` can be any name for your replica set (e.g., "rs0")
2. Access the machine running `mongod` using the mongo cli and enter `rs.initiate()`.
3. Type `rs.status()` to verify that the "ok" property equals 1.  
    - NOTE: In a dockerized mongo deployment you may need to refer to [this](https://docs.mongodb.com/manual/tutorial/reconfigure-replica-set-with-unavailable-members/) documentation in order to change `members[0].host` property in rs.config() to `localhost:27017` if it is set to something invalid.
4. Set the environment variable `mongo_replica_set=true` for SLPDB.

### Using docker

Docker can be used to easily test mongo in different configurations.  The `docker-compose.yml` file in this directory is based on [this article](`https://blog.skbali.com/2019/05/mongodb-replica-set-using-docker-compose/`)

1. To start docker use: `docker-compose up -d`

2. First time setting up replica set
  - start mongod with `--replSet <name>` option 
  - `docker exec -it mongo1 mongo`
  - `rs.initiate()`
  - (optional) `rs.add('mongo2')`  
  - (optional) `rs.add('mongo3')`  
  - (optional) `rs.printSlaveReplicationInfo()`  
