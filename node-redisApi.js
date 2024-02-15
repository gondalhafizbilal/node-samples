const Debug = require('debug');
const Redis = require('ioredis');
const OneStreamConfig = require('../configuration');

const logInfo = Debug('app:lib:redis: [INFO]');
logInfo.useColors = true;
logInfo.log = console.info.bind(console);

// error logs
const logError = Debug('app:lib:redis: [ERROR]');
logError.useColors = true;
logError.log = console.error.bind(console);


const oneStreamConfigInstance = OneStreamConfig();
const selfHostedConfig = oneStreamConfigInstance.getConfig('self_hosted');
let {
    redis: redisConfig
} = selfHostedConfig;

// if sentinel is set - we use sentinel
if (redisConfig.sentinel) {
    const {
        sentinelConfig
    } = redisConfig;

    // set retry strategy
    sentinelConfig.sentinelRetryStrategy = function (times) {
        const delay = Math.min(times * 100, 5000);
        return delay;
    }

    redisConfig = sentinelConfig;
} else 
    redisConfig.retryStrategy = function (times) {
        return Math.min(times * 50, 2000);
    };


class RedisApi {
    constructor() {
        this._pub = new Redis(redisConfig);

        this._pingInterval = null;

        this._pub.on('connect', () => {
            logInfo('Redis connected');
            this._pingInterval = setInterval(() => {
                return this._pub.call('PING')
                            .then((result) => logInfo('received heartbeat:', result))
                            .catch((error) => logError('error while sending ping', error));
            }, 40000);

        });

        this._pub.on('ready', () => {
            logInfo('Redis Ready');
        });

        this._pub.on('disconnect', (event) => {
            logInfo('Redis disconnected', event);
            clearInterval(this._pingInterval);
        });

        this._pub.on('reconnect', (event) => {
            logInfo('Redis reconnecting', event);
        });

        this._pub.on('error', (error) => {
            logError('Redis error:', error.message);
            clearInterval(this._pingInterval);
        });

        this._pub.on('close', () => {
            logInfo('Redis closed');
            clearInterval(this._pingInterval);
        })
    }

    subscribe(channelList) {
        channelList.forEach(channel => {
            this._pub.subscribe(channel, (err, count) => {
                if (!err) {
                    logInfo(`subscribed ${channel}, total ${count}`);
                } else {
                    logError(err);
                }
            });
        });
    }

    unsubscribe(channelList) {
        channelList.forEach(channel => {
            this._pub.unsubscribe(channel);
        });

    }

    publishMessage(channel, message) {
        logInfo('publishing message', message);
        return new Promise((resolve, reject) => {
            return this._pub.publish(channel, message)
                .then(resolve)
                .catch(reject);
        });
    }

    listenForMessages(cb) {
        this._pub.on('message', (channel, message) => {
            cb(channel, message);
        });
    }

    get status() {
        return this._pub.status;
    }

    get client() {
        return this._pub;
    }

    keys(pattern) {
        return new Promise((resolve, reject) => {
            return this._pub.keys(pattern)
                .then(resolve)
                .catch(reject)
        })
    }

    getKeyData(key) {
        return new Promise((resolve, reject) => {
            return this._pub.get(key)
                .then(resolve)
                .catch(reject);
        });
    }

    setKeyData(key, value, expiry = 10) {
        return new Promise((resolve, reject) => {
            return this._pub.set(key, value, 'EX', expiry)
                .then(resolve)
                .catch(reject);
        });
    }

    appendKeyData(key, data) {
        return new Promise((resolve, reject) => {
            return this._pub.append(key, data)
                .then(resolve)
                .catch(reject);
        });
    }

    keyExists(key) {
        return new Promise((resolve, reject) => {
            return this._pub.exists(key)
                .then(resolve)
                .catch(reject);
        });
    }

    hmset(hash, ...value) {
        return new Promise((resolve, reject) => {
            return this._pub.hmset(hash, ...value)
                .then(resolve)
                .catch(reject);
        });
    }

    hmget(hash, fields) {
        return new Promise((resolve, reject) => {
            return this._pub.hmget(hash, fields)
                .then(resolve)
                .catch(reject);
        });
    }

    setKeyExpiry(key, expiry) {
        return new Promise((resolve, reject) => {
            return this._pub.expire(key, expiry)
                .then(resolve)
                .catch(reject);
        });
    }

    hset(hash, key, ...value) {
        return new Promise((resolve, reject) => {
            return this._pub.hset(hash, key, ...value)
                .then(resolve)
                .catch(reject);
        });
    }

    hget(hash, key) {
        return new Promise((resolve, reject) => {
            return this._pub.hget(hash, key)
                .then(resolve)
                .catch(reject);
        });
    }

    hgetAll(hash) {
        return new Promise((resolve, reject) => {
            return this._pub.hgetall(hash)
                .then(resolve)
                .catch(reject);
        });
    }

    delKey(key) {
        return new Promise((resolve, reject) => {
            return this._pub.del([key])
                .then(resolve)
                .catch(reject);
        });
    }

    addKeyToList(listName, items) {
        return new Promise((resolve, reject) => {
            this._pub.rpush(listName, items)
                .then(resolve)
                .catch(reject)
        });
    }

    getListKeys(listName, startIndex, endIndex) {
        return new Promise((resolve, reject) => {
            this._pub.lrange(listName, startIndex, endIndex)
                .then(resolve)
                .catch(reject)
        });
    }

    getListLength(listName) {
        return new Promise((resolve, reject) => {
            this._pub.llen(listName)
                .then(resolve)
                .catch(reject)
        });
    }

    setKeyToHash(hashName, field, value) {
        return new Promise((resolve, reject) => {
            this._pub.hset(hashName, field, value)
                .then(resolve)
                .catch(reject)
        });
    }


    keyExistsInHash(hashName, field) {
        return new Promise((resolve, reject) => {
            this._pub.hexists(hashName, field)
                .then(resolve)
                .catch(reject)
        });
    }

    delKeyFromHash(hashName, field) {
        return new Promise((resolve, reject) => {
            this._pub.hdel(hashName, field)
                .then(resolve)
                .catch(reject)
        });
    }

    getKeyFromHash(hashName, field) {
        return new Promise((resolve, reject) => {
            this._pub.hget(hashName, field)
                .then(resolve)
                .catch(reject)
        });
    }

    getAllKeysFromHash(hashName) {
        return new Promise((resolve, reject) => {
            this._pub.hgetall(hashName)
                .then(resolve)
                .catch(reject)
        });
    }
}

module.exports = new RedisApi;