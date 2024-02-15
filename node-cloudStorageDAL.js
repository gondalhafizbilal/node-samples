const models    = require('@project/models');
const { Debug } = require('@project/utils');

const {
    CloudStorage
} = models;

const Op = models.Sequelize.Op;

const {
    logInfo,
    logError
} = Debug('app:service:v2:cloud-storage');

class CloudStorageDAL {
    static getAllCloudStoragesByUserId(cloudStorageContext) {
        logInfo('get all Cloud Storages by user account id', cloudStorageContext);
        return new Promise((resolve, reject) => {
            const {
                userAccountId
            } = cloudStorageContext;

            return CloudStorage.findAll({
                where: {
                    userAccountId: {
                        [Op.eq]: userAccountId
                    }
                },
                attributes: ['id', 'name', 'vendor', 'bucket']
            })
            .then(resolve)
            .catch(reject);
        });
    }

    static getCloudStorageById(cloudStorageId) {
        return new Promise((resolve, reject) => {
            return CloudStorage.findOne({
                where: {
                    id: {
                        [Op.eq]: cloudStorageId
                    }
                }
            })
            .then(resolve)
            .catch(reject);
        });
    }

    static updateCloudStorage (cloudStorageId, feilds) {
        return new Promise((resolve, reject) => {
            return CloudStorage.update({ ...feilds }, {
                where: {
                    id: {
                        [Op.eq]: cloudStorageId
                    }
                }
            })
            .then(resolve)
            .catch(reject);
        });
    }

    static deleteCloudStoragesByUserId(cloudStorageContext) {
        logInfo('deleting Cloud Storages by user id', cloudStorageContext);
        return new Promise((resolve, reject) => {
            const {
                userAccountId
            } = cloudStorageContext;

            return CloudStorage.destroy({
                where: {
                    userAccountId: {
                        [Op.eq]: userAccountId
                    }
                }
            })
            .then(resolve)
            .catch(reject);
        });
    }

    static deleteCloudStorageById(id) {
        return new Promise((resolve, reject) => {
            return CloudStorage.destroy({
                where: {
                    id: {
                        [Op.eq]: id
                    }
                }
            })
            .then(resolve)
            .catch(reject)
        })
    }

    static createCloudStorage(cloudStorageContext) {
        return new Promise((resolve, reject) => {
            return CloudStorage.create(cloudStorageContext)
            .then(resolve)
            .catch(reject);
        });
    }
}

module.exports = CloudStorageDAL;