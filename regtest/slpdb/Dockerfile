FROM node:12-alpine

RUN apk update && apk upgrade && \
    apk add --no-cache bash git openssh

RUN apk add --no-cache --virtual build-dependencies python --update py-pip \
    build-base python-dev make automake autoconf libtool \
    && pip install --upgrade pip \
    && rm -rf /var/cache/apk/*

RUN mkdir -p /usr/src/SLPDB

WORKDIR /usr/src

RUN git clone https://github.com/simpleledger/SLPDB.git && cd SLPDB
WORKDIR /usr/src/SLPDB
RUN npm install
RUN git fetch --all && git checkout c2f6763ab9c1a80d68b1c8bd37fee0180e143758
RUN npm install

COPY regtest.env .env
COPY filters.regtest.yml filters.yml
COPY ./docker-entrypoint.sh ./entrypoint.sh

ENTRYPOINT [ "./entrypoint.sh" ]
CMD [ "run" ]
