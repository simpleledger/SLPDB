## MongoDB Replica set dev environment

This directory is based on this article: `https://blog.skbali.com/2019/05/mongodb-replica-set-using-docker-compose/`


- `docker-compose up -d`

## First time setting up replica set
- `docker exec -it mongo1 mongo`
- `rs.initiate()`
- `rs.add('mongo2')`  (optional)
- `rs.add('mongo3')`  (optional)
- `rs.printSlaveReplicationInfo()`  (optional)