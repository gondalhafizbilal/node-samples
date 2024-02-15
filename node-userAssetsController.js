'use strict';
const path = require('path');
const sharp = require('sharp');
const { Storage } = require('@google-cloud/storage');
const { Debug, Utils } = require('@onestream/utils');
const redisLock = require('redislock')
const {
    ACL,
    RedisApi,
    validateImageUrl
} = require('@onestream/libs');
const config = require('@onestream/config');

const {
    UserAssetsService,
    ScheduleService,
    ChargebeeService,
    TeamService,
    TemplatesService
} = require('../../services/dal');

const {
    UserAssetsError,
    ErrorCodes
} = require('../../common/errors');

// configs
const settings = config.config;

const OneStreamConfigSingleton = require('@onestream/libs/configuration');
const envConfig = OneStreamConfigSingleton().getConfig('env');
const constants = require('@onestream/config').constants;

const credsKeyFile = envConfig.GOOGLE_APPLICATION_CREDENTIALS;

// get storage instance
const storage = new Storage({
    keyFilename: credsKeyFile
});


const redisClient = RedisApi.client;
const LockAcquisitionError = redisLock.LockAcquisitionError;
const LockReleaseError = redisLock.LockReleaseError;

const cdnAssetsBasePath = settings.storage.cdn.assets.path;
const assetsBucketName = settings.storage.cloud.GCS.assets.bucket;
const assetsBucket = storage.bucket(assetsBucketName);

const { assetsToBucket } = require('../../businessLogics')

const { logInfo, logError } = Debug('app:controller:v2:user-assets');

const UserAssetsController = {

    /**
     * @api {Post} /storage/uploads/assets Upload Asset
     * @apiVersion 2.0.0
     * @apiName   Upload Asset
     * @apiGroup  Assets
     * 
     * @apiHeader {String} x-access-token The user's jwt token that is acquired when the user logs in.
     * @apiHeader {String} Origin Use http://localhost:3000.
     * 
     * @apiParam   (Form Data)      {File}      file                Asset File                        
     * @apiParam   (Request Body)   {String}    asset_name          Asset Name 
     * @apiParam   (Request Body)   {String}    asset_type          Asset Type
     * @apiParam   (Query string)   {String}    team_id             Team ID only for team videos (Optional)  
     *
     * @apiSuccess {String} name            Asset name.
     * @apiSuccess {String} type            Asset type.
     * @apiSuccess {String} url             Asset url.
     * @apiSuccess {Number} userAccountId   User Account Id.
     * @apiSuccess {String} uuid            UUID for Asset.
     *
     * @apiSuccessExample {json} Success-Example
     * HTTP/1.1 200 OK
     * {
     *     "uuid":"9e4dcfa2-a14b-4530-84d3-951ce6307d3c",
     *     "name":"logo-social.png",
     *     "type":"logo",
     *     "url":"https://cdn-staging.assets.onestream.live/131475/asset_logo-131475__4gi7phpig1620375353369.png",
     *     "userAccountId":131475}
     * }
     * 
     * @apiErrorExample {json} Failure-Example
     * HTTP/1.1 400 Bad Request
     * {
     *    "error": "file is not sent"
     * }
     * 
     * HTTP/1.1 400 Bad Request
     * {
     *    "error": "Cannot use this feature with current plan"
     * }
     * 
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Your subscription does not allow to use this feature - please upgrade"
     * }
     *  
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Your assets XYZ limit has been reached - either delete old one or upgrade"
     * }
     * 
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Not authorized to upload logo assets for this team"
     * }
     * 
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Your team owner requires a subscription in order to upload logo assets for team"
     * }
     * 
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Your team assets ${assetType} limit has been reached - either delete old one or upgrade"
     * }
    */
    handleAssetUpload: async (req, res, next) => {
        logInfo('handling asset upload request for user %d', req.decoded._id);
        const userAccountId = req.decoded._id;
        const lockId = `assets:create:userId:${userAccountId}:lock`;
        const asset_link = req.body.asset_link;
        let lock = null;
        try {
            if (!req.file && !asset_link) {
                logError('file is not sent');
                return next(new UserAssetsError('file is not sent', 400));
            }

            // only logo related assets can be uploaded by team member
            if (req.query.team_id && req.query.assetType && req.query.assetType === 'logo') {
                logInfo('asset upload request is for team - moving to next handler');
                return next();
            }

            const userSubscription = req.decoded._subscription;
            const features = req.decoded._features;
            const buffer = req.file ? req.file.buffer : '';
            const fieldName = req.file ? req.file.fieldname : '';
            const assetName = req.body.asset_name;
            const assetType = req.body.asset_type;
            const updatedAssetId = req.params.Id;;

            const userOwnTeams = req.decoded._teams;
            const usePng = req.query.png;
            const extension = req.file ? path.extname(req.file.originalname) : '';
            const streamTemplateImageTypes = constants.StreamTemplateImageTypes
            const streamTemplateImageLinkTypes = constants.StreamTemplateImageLinkTypes
            // don't allow free user
            if (userSubscription === 0) {
                return next(new UserAssetsError('Cannot use this feature with current plan', 400));
            }

            let addonWatermark = false;
            const watermarkAddon = features.addons.filter(addon => addon.service === 'watermark');
            if (watermarkAddon.length > 0) {
                addonWatermark = watermarkAddon[0].allowed;
            }

            if (features.assets === 0 && !addonWatermark) {
                return next(new UserAssetsError('Your subscription does not allow to use this feature - please upgrade', 403));
            }

            let allowedAssets = null;
            let isEmbedPlayerAsset = false;
            let isEmbedPlayerAssetLink = false;
            let isStudioAsset = false;
            if (assetType === 'hostedpage_logo') {
                const assets = await UserAssetsService.getUserAssetsByUserIdWithExclusion(userAccountId, ['createdAt', 'updatedAt']);
                const hostedPageAssets = assets.filter(asset => asset.type === 'hostedpage_logo');
                if (hostedPageAssets.length > 0) {
                    for (const hostedPageAsset of hostedPageAssets) {
                        const assetPathInBucket = hostedPageAsset.path;
                        //await assetsBucket.file(assetPathInBucket).delete();
                        await assetsToBucket.deleteAssetFromBucket({ filePath: assetPathInBucket })
                        await UserAssetsService.deleteUserAssetById({ assetId: hostedPageAsset.uuid, userAccountId });
                    }
                }
                // if addon is set - we use standard asset numbers of 3
                allowedAssets = features.assets > 0 ? features.assets + 1 : 4;
            }
            else if (assetType === 'embed_player_thumbnail') {
                const assets = await UserAssetsService.getUserAssetsByUserIdWithExclusion(userAccountId, ['createdAt', 'updatedAt']);
                const embedPlayerAssets = assets.filter(asset => asset.type === 'embed_player_thumbnail');
                if (embedPlayerAssets.length > 0) {
                    for (const embedPlayerAsset of embedPlayerAssets) {
                        const assetPathInBucket = embedPlayerAsset.path;
                        try {
                            //await assetsBucket.file(assetPathInBucket).delete();
                            await assetsToBucket.deleteAssetFromBucket({ filePath: assetPathInBucket })
                        } catch (error) {
                            logError('error while removing asset file %s', assetPathInBucket)
                        }
                        await UserAssetsService.deleteUserAssetById({ assetId: embedPlayerAsset.uuid, userAccountId });
                    }
                }
                isEmbedPlayerAsset = true;
            }
            else if (assetType === 'studio_layout_logo') {
                // Todo: ACL on how many studio asset the user can keep
                try {
                    isStudioAsset = true;
                } catch (error) {
                    logError(error);
                }
            } else if (assetType === 'studio_banner_logo') {
                // Todo: ACL on how many studio asset the user can keep
                try {
                    isStudioAsset = true;
                } catch (error) {
                    logError(error);
                }
            } else if (assetType === 'studio_live_sales') {
                // Todo: ACL on how many studio asset the user can keep
                try {
                    isStudioAsset = true;
                } catch (error) {
                    logError(error);
                }
            } else if (assetType === 'studio_background') {
                // Todo: ACL on how many studio asset the user can keep
                try {
                    isStudioAsset = true;
                } catch (error) {
                    logError(error);
                }
            } else if (assetType === 'studio_video_override') {
                // Todo: ACL on how many studio asset the user can keep
                try {
                    isStudioAsset = true;
                } catch (error) {
                    logError(error);
                }
            }
            else if (streamTemplateImageTypes.indexOf(assetType) != -1) {
                // Todo: ACL on how many studio asset the user can keep
                try {
                    isEmbedPlayerAsset = true;
                } catch (error) {
                    logError(error);
                }
            }
            else if (streamTemplateImageLinkTypes.indexOf(assetType) != -1) {

                // Todo: ACL on how many studio asset the user can keep
                try {
                    let isImage = await validateImageUrl(asset_link)
                    if (!isImage) {
                        return next(new UserAssetsError('Your Image Url Is Not Valid!', 400));
                    }

                    isEmbedPlayerAssetLink = true;
                } catch (error) {
                    logError(error);
                    return next(new UserAssetsError('Partial Service Outage', 500));
                }
            }
            else {
                // if addon is set - we use standard asset numbers of 3
                allowedAssets = features.assets > 0 ? features.assets : 3;
            }

            // use sharp to convert image to png
            let outputBuffer = null;
            if (usePng) {
                try {
                    outputBuffer = await sharp(buffer).png().toBuffer();
                } catch (error) {
                    logError('error while converting image buffer to png', error);
                }
            }

            let toUploadAssetName = '';
            let assetURL = '';

            if (isEmbedPlayerAssetLink === true) {
                //toUploadAssetName = asset_link;
                assetURL = asset_link;
            } else {
                toUploadAssetName = `${userAccountId}/${Utils.generateRandomImageName(fieldName + '-' + assetType, userAccountId, outputBuffer ? '.png' : extension)}`;
                assetURL = `${cdnAssetsBasePath}${toUploadAssetName}`;
            }


            if (!outputBuffer)
                outputBuffer = buffer;

            const assetContext = {
                name: assetName,
                type: assetType,
                url: assetURL,
                path: toUploadAssetName,
                userAccountId,
                updatedAssetId,
                team_id: userOwnTeams && userOwnTeams.length > 0 ? userOwnTeams[0].teamId : null // fixing water mark asset issue for team
            };

            if (isEmbedPlayerAssetLink === true) {
                try {

                    let linkAssetsAdded = await UserAssetsService.createAssetWithoutTx(assetContext);
                    delete linkAssetsAdded.dataValues.path;
                    delete linkAssetsAdded.dataValues.createdAt;
                    delete linkAssetsAdded.dataValues.updatedAt;
                    return res.status(200).json(linkAssetsAdded);

                } catch (error) {
                    logError('error while creating link asset', error);
                    return next(new UserAssetsError('Partial Service Outage', 500));
                }

            }
            // acquire redis-lock
            lock = redisLock.createLock(redisClient, {
                timeout: 20000,
                retries: 190,
                delay: 100
            });

            await lock.acquire(lockId);

            let newlyCreatedAsset = null;
            try {
                if (isEmbedPlayerAsset) {
                    newlyCreatedAsset = await UserAssetsService.createAssetWithoutTx(assetContext);
                } else if (isStudioAsset) {
                    newlyCreatedAsset = await UserAssetsService.createAssetWithoutTx(assetContext);
                } else newlyCreatedAsset = await UserAssetsService.createAssetWithoutTx(assetContext, allowedAssets);
            } catch (error) {
                logError('error while creating asset', error);
            }

            await lock.release();
            if (!newlyCreatedAsset) {
                logError(`User assets ${assetType} limit has been reached - cannot process further`);
                return next(new UserAssetsError(`Your assets ${assetType} limit has been reached - either delete old one or upgrade.`, 403));
            }

            delete newlyCreatedAsset.dataValues.path;
            delete newlyCreatedAsset.dataValues.createdAt;
            delete newlyCreatedAsset.dataValues.updatedAt;

            await assetsToBucket.save({ toUploadAssetName, extension, outputBuffer })

            return res.status(200).json(newlyCreatedAsset);
        } catch (error) {
            logError(error);
            if (lock) {
                try {
                    await lock.release();
                } catch (error) {
                    logError('error while releasing lock', error);
                }
            }
            return next(new UserAssetsError('Partial Service Outage', 500));
        }
    },

    handleTeamAssetUpload: async (req, res, next) => {
        logInfo('handling team %d asset upload request for user %d', req.query.team_id, req.decoded._id);
        const teamId = req.query.team_id;
        const lockId = `assets:create:teamId:${teamId}:lock`;
        let lock = null;
        try {
            const teamId = req.query.team_id;
            const userAccountId = req.decoded._id;
            const buffer = req.file.buffer;
            const fieldName = req.file.fieldname;
            const assetName = req.body.asset_name;
            const assetType = req.body.asset_type;
            const usePng = req.query.png;
            const extension = path.extname(req.file.originalname);

            const team = await TeamService.getTeamWithMembersByTeamId(teamId);
            if (!team || !team.TeamUsers) return next(new UserAssetsError('Not authorized to upload logo assets for this team', 403));

            const teamOwnerId = team.team_owner_id;
            const teamUsers = team.TeamUsers;
            const isTeamUser = teamUsers.some(teamUser => teamUser.user_account_id === userAccountId);
            if (!isTeamUser) {
                return next(new UserAssetsError('Not authorized to upload logo assets for this team', 403));
            }

            const teamOwnerSubscription = await ChargebeeService.getSubscriptionByUserId(teamOwnerId);
            if (!teamOwnerSubscription) return next(new UserAssetsError('Your team owner requires a subscription in order to upload logo assets for team', 403));

            const AssetsACL = new ACL(teamOwnerSubscription.planId);
            if (AssetsACL.allowedLogoAssets() === 0) {
                return next(new UserAssetsError(`Your team assets ${assetType} limit has been reached - either delete old one or upgrade.`, 403));
            }

            let outputBuffer = null;
            if (usePng) {
                try {
                    outputBuffer = await sharp(buffer).png().toBuffer();
                } catch (error) {
                    logError('error while converting image buffer to png', error);
                }
            }

            const toUploadAssetName = `${teamOwnerId}/${Utils.generateRandomImageName(fieldName + '-' + assetType, teamOwnerId, outputBuffer ? '.png' : extension)}`;
            const assetURL = `${cdnAssetsBasePath}${toUploadAssetName}`;

            if (!outputBuffer)
                outputBuffer = buffer;

            const assetContext = {
                name: assetName,
                type: assetType,
                url: assetURL,
                path: toUploadAssetName,
                team_id: teamId,
                userAccountId
            };

            lock = redisLock.createLock(redisClient, {
                timeout: 20000,
                retries: 190,
                delay: 100
            });

            await lock.acquire(lockId);
            const allowedAssets = AssetsACL.allowedLogoAssets();

            let newlyCreatedAsset = null;
            try {
                newlyCreatedAsset = await UserAssetsService.createAssetWithoutTx(assetContext, allowedAssets);
            } catch (error) {
                logError('error while creating asset', error);
            }

            await lock.release();
            if (!newlyCreatedAsset) {
                logError(`team assets ${assetType} limit has been reached - cannot process further`);
                return next(new UserAssetsError(`Your team assets ${assetType} limit has been reached - either delete old one or upgrade.`, 403));
            }

            delete newlyCreatedAsset.dataValues.path;
            delete newlyCreatedAsset.dataValues.createdAt;
            delete newlyCreatedAsset.dataValues.updatedAt;

            await assetsToBucket.save({ toUploadAssetName, extension, outputBuffer })
            // release redis-lock

            return res.status(200).json(newlyCreatedAsset);
        } catch (error) {
            logError(error);
            if (lock) {
                try {
                    await lock.release();
                } catch (error) {
                    logError('error while releasing lock', error);
                }
            }
            return next(new UserAssetsError('Partial Service Outage', 500));
        }
    },

    /**
     * @api {Get} /storage/uploads/assets Get Assets
     * @apiVersion 2.0.0
     * @apiName    Get Assets
     * @apiGroup   Assets
     * 
     * @apiHeader {String} x-access-token The user's jwt token that is acquired when the user logs in.
     * @apiHeader {String} Origin Use http://localhost:3000.
     * 
     * @apiParam   (Query string)   {Number}    team_id     Team ID only for team videos (Optional)
     *
     * @apiSuccess {Array}  Asset array with attributes    
     *
     * @apiSuccessExample {json} Success-Example
     * HTTP/1.1 200 OK
     * {
     *   [
     *      {
     *          "uuid":"268cc75d-5371-49f2-abb1-8e1c5cf005ad",
     *          "name":"logo-social.png",
     *          "type":"logo",
     *          "url":"https://cdn-staging.assets.onestream.live/131475/asset_logo-131475__b72axw3p01620377619061.png",
     *          "userAccountId":131475,
     *          "team_id":null
     *      }
     *   ]
     * }
     * 
     * @apiErrorExample {json} Failure-Example
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Not authorized to get logo asset for this team"
     * }
    */
    handleGetAssets: async (req, res, next) => {
        logInfo('handling get assets for user %d', req.decoded._id);
        try {
            if (req.query.team_id) {
                logInfo('requesting assets for team - moving to next handler');
                return next();
            }

            const userAccountId = req.decoded._id;
            const team = await TeamService.getTeamByUserAccountId(userAccountId);
            let teamAssets = [];
            if (team) {
                teamAssets = await UserAssetsService.getUserAssetsByTeamId(team.id);
            }

            let assets = await UserAssetsService.getUserAssetsByUserId(userAccountId);
            if (teamAssets) {
                assets.push(...teamAssets)
            }

            // fixing water mark asset issue for team (removing duplication)
            assets = assets.filter((v, i, a) => a.findIndex(t => (t.uuid === v.uuid)) === i);
            return res.status(200).json(assets);

        } catch (error) {
            next(error);
        }
    },

    handleGetTeamAssets: async (req, res, next) => {
        logInfo('handling get team %d assets for %d', req.query.team_id, req.decoded._id);
        try {
            const userAccountId = req.decoded._id;
            const teamId = req.query.team_id;
            const team = await TeamService.getTeamWithMembersByTeamId(teamId);
            if (!team || !team.TeamUsers) return next(new UserAssetsError('Not authorized to get logo assets for this team', 403));

            const teamUsers = team.TeamUsers;

            const isTeamMember = teamUsers.some(teamUser => teamUser.user_account_id === userAccountId);
            if (!isTeamMember) return next(new UserAssetsError('Not authorized to get logo assets for this team', 403));

            const teamAssets = await UserAssetsService.getUserAssetsByTeamId(teamId);

            return res.status(200).json(teamAssets);

        } catch (error) {
            next(error);
        }
    },

    /**
     * @api {Get} /storage/uploads/assets/:Id Get Asset By Id
     * @apiVersion 2.0.0
     * @apiName   Get Asset By Id
     * @apiGroup  Assets
     * 
     * @apiHeader {String} x-access-token The user's jwt token that is acquired when the user logs in.
     * @apiHeader {String} Origin Use http://localhost:3000.
     * 
     * @apiParam   (Query string)   {Number}    team_id     Team ID only for team videos (Optional)
     * @apiParam                    {String}    uuid        Assets's UUID    
     *
     * @apiSuccess                  {String}    uuid            Assets's UUID
     * @apiSuccess                  {String}    name            Assets's name
     * @apiSuccess                  {String}    type            Assets's type
     * @apiSuccess                  {String}    url             Assets's url
     * @apiSuccess                  {Number}    userAccountId   User Account Id.
     * @apiSuccess                  {Number}    team_id         Team id if asset belongs to team.
     *
     * @apiSuccessExample {json} Success-Example
     * HTTP/1.1 200 OK
     * {
     *      "uuid":"268cc75d-5371-49f2-abb1-8e1c5cf005ad",
     *      "name":"logo-social.png",
     *      "type":"logo",
     *      "url":"https://cdn-staging.assets.onestream.live/131475/asset_logo-131475__b72axw3p01620377619061.png",
     *      "userAccountId":131475,
     *      "team_id":null
     * }
     * 
     * @apiErrorExample {json} Failure-Example
     * HTTP/1.1 404 Not Found
     * {
     *    "error": "Asset not found"
     * }
     * 
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Not authorized to get logo asset for this team"
     * }
     *  
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Not allowed to access this asset"
     * }
    */
    handleGetAsset: async (req, res, next) => {
        logInfo('handling get asset %s by user %d', req.params.Id, req.decoded._id);
        try {

            if (req.query.team_id) {
                logInfo('asset requested for team - moving to next handler');
                return next();
            }

            const userAccountId = req.decoded._id;
            const assetId = req.params.Id;

            let asset = await UserAssetsService.getUserAssetById(assetId);
            if (!asset || asset.team_id !== null) {
                const team = await TeamService.getTeamByUserAccountId(userAccountId);
                if (!team) {
                    return next(new UserAssetsError('Asset not found', 404));
                }
                if (team) {
                    asset = await UserAssetsService.getUserAssetByTeamId({ teamId: team.id, assetId });
                    if (!asset) return next(new UserAssetsError('Asset not found', 404));
                }

            } else {
                if (asset.userAccountId !== userAccountId) {
                    return next(new UserAssetsError('Not allowed to access this asset', 403));
                }

                delete asset.dataValues.path;
                delete asset.dataValues.createdAt;
                delete asset.dataValues.updatedAt;
            }

            return res.status(200).json(asset);
        } catch (error) {
            next(error);
        }
    },

    //   update password
    handleGetTeamAsset: async (req, res, next) => {
        logInfo('handling get team %d asset %d by user %d', req.query.team_id, req.params.Id, req.decoded._id);
        try {
            const userAccountId = req.decoded._id;
            const assetId = req.params.Id;
            const teamId = req.query.team_id;

            const team = await TeamService.getTeamWithMembersByTeamId(teamId);
            if (!team || !team.TeamUsers) return next(new UserAssetsError('Not authorized to get logo asset for this team', 403));

            const teamUsers = team.TeamUsers;

            const isTeamMember = teamUsers.some(teamUser => teamUser.user_account_id === userAccountId);
            if (!isTeamMember) return next(new UserAssetsError('Not authorized to get logo asset for this team', 403));

            const teamAsset = await UserAssetsService.getUserAssetById(assetId);
            if (!teamAsset || teamAsset.uuid !== assetId || teamAsset.team_id !== teamId) {
                return next(new UserAssetsError('Not authorized to get logo asset for this team', 403));
            }

            // Send response
            return res.status(200).json(teamAsset);
        } catch (error) {
            next(error);
        }
    },

    /**
     * @api {Delete} /storage/uploads/assets/:uuid Delete Asset By Id
     * @apiVersion 2.0.0
     * @apiName   Delete Asset By Id
     * @apiGroup  Assets
     * 
     * @apiHeader {String} x-access-token The user's jwt token that is acquired when the user logs in.
     * @apiHeader {String} Origin Use http://localhost:3000.
     * 
     * @apiParam   (Query string)   {Number}    team_id     Team ID only for team videos (Optional)
     * @apiParam                    {String}    uuid        Asset's UUID   
     *
     * @apiSuccess {Boolean}  success   true or false.
     * @apiSuccess {String}   message   message for success.
     *
     * @apiSuccessExample {json} Success-Example
     * HTTP/1.1 200 OK
     * {
     *   success: true
     *   message: 'Logo asset has been removed successfully!'
     * }
     * 
     * @apiErrorExample {json} Failure-Example
     * HTTP/1.1 400 Bad Request
     * {
     *    "error": "Logo asset not found - invalid rquest"
     * }
     * 
     * HTTP/1.1 403 Forbidden
     * {
     *    "error": "Not allowed to remove this asset"
     * }
     * 
     * HTTP/1.1 400 Bad Request
     * {
     *    "error": "Cannot delete this logo asset. This logo has been associated with schedule(s)"
     * }
    */
    handleDeleteAsset: async (req, res, next) => {
        logInfo('handling delete asset %s by user %d', req.params.Id, req.decoded._id);
        try {
            if (req.query.team_id) {
                logInfo('delete asset requested for team %d - moving to next handler', req.query.teamId);
                return next();
            }

            const userAccountId = req.decoded._id;
            const assetId = req.params.Id;
            let assetRemoved = false;
            const isUpdateDelete = req.query.isUpdateDelete || false;

            let deleteTeamAssetContext = null;
            const deleteAssetContext = {
                userAccountId,
                assetId
            };

            let asset = await UserAssetsService.getUserAssetById(assetId);

            if (!asset || asset.team_id !== null) {
                const team = await TeamService.getTeamByUserAccountId(userAccountId);
                if (!team) {
                    return next(new UserAssetsError('Logo asset not found - invalid rquest', 400));
                }
                if (team) {
                    asset = await UserAssetsService.getUserAssetByTeamId({
                        teamId: team.id,
                        assetId
                    }, ['createdAt', 'updatedAt']);
                    if (!asset) return next(new UserAssetsError('Logo asset not found - invalid rquest', 400));
                    // set delete team asset context
                    deleteTeamAssetContext = {
                        teamId: team.id,
                        assetId
                    };
                }
            } else {
                if (asset.userAccountId !== userAccountId || asset.team_id !== null) {
                    return next(new UserAssetsError('Not allowed to remove this asset', 403));
                }
            }


            // check if logo is associated with schedule
            const schedules = await ScheduleService.getAllSchedulesByAssetId(assetId);
            if (schedules.length > 0) {
                return next(new UserAssetsError(`Cannot delete this logo asset. This logo has been associated with ${schedules.length} schedule(s)`, 400));
            }

            const assetPath = asset.path;

            for (let tries = 0; tries < 4; tries++) {
                try {
                    logInfo('trying to delete asset %s from bucket', assetPath);
                    if (!assetPath && isUpdateDelete) {
                        return { message: 'Assset has been removed successfully!!' }
                    }
                    if (assetPath) {
                        //await assetsBucket.file(assetPath).delete();
                        await assetsToBucket.deleteAssetFromBucket({ filePath: assetPath })
                        if (isUpdateDelete) {
                            return { message: 'Assset has been removed successfully!!' }
                        }
                        if (deleteTeamAssetContext) {
                            await UserAssetsService.deleteUserAssetByTeamId(deleteTeamAssetContext);
                        } else await UserAssetsService.deleteUserAssetById(deleteAssetContext);
                        assetRemoved = true;
                        break;
                    } else {

                        if (deleteTeamAssetContext) {
                            await UserAssetsService.deleteUserAssetByTeamId(deleteTeamAssetContext);
                        } else await UserAssetsService.deleteUserAssetById(deleteAssetContext);
                        assetRemoved = true;
                        break;
                    }

                } catch (error) {
                    logError(error);
                    if (isUpdateDelete) {
                        return { message: 'Assset has been removed successfully!!' }
                    }
                    // if asset is not found - 404 - we skip it
                    if (error && error.code && (error.code === 404 || error.code === 'ENOENT')) {
                        if (deleteTeamAssetContext) {
                            await UserAssetsService.deleteUserAssetByTeamId(deleteTeamAssetContext);
                        } else await UserAssetsService.deleteUserAssetById(deleteAssetContext);
                        assetRemoved = true;
                        break;
                    } else
                        logError('failed to delete asset - retrying delete - attempt %d', tries, error);
                }
            }

            if (!assetRemoved) {
                logError('could not remove asset %s', assetPath);
                return next(new UserAssetsError('Unable to remove asset - please contact OneStream Customer Support', 400));
            }


            // return response
            return res.status(200).json({ success: true, message: 'Assset has been removed successfully!' });
        } catch (error) {
            next(error);
        }
    },

    //   update password
    handleDeleteTeamAsset: async (req, res, next) => {
        logInfo('handling delete team %d asset %d by user %d', req.query.team_id, req.params.Id, req.decoded._id);
        try {
            const teamId = req.query.team_id;

            const assetId = req.params.Id;
            const userAccountId = req.decoded._id;

            const team = await TeamService.getTeamWithMembersByTeamId(teamId);
            if (!team || !team.TeamUsers) return next(new UserAssetsError('Not authorized to get logo asset for this team', 403));

            const teamUsers = team.TeamUsers;

            const isTeamMember = teamUsers.some(teamUser => teamUser.user_account_id === userAccountId);
            if (!isTeamMember) return next(new UserAssetsError('Not authorized to delete logo asset for this team', 403));

            const teamAsset = await UserAssetsService.getUserAssetById(assetId);

            if (!teamAsset || teamAsset.uuid !== assetId || teamAsset.team_id !== teamId) {
                return next(new UserAssetsError('Not authorized to get logo asset for this team', 403));
            }

            if (teamAsset.team_id !== teamId) {
                return next(new UserAssetsError('Not authorized to get logo asset for this team', 403));
            }

            const deleteAssetContext = {
                teamId,
                assetId
            };

            // check if logo is associated with schedule
            const schedules = await ScheduleService.getAllSchedulesByAssetId(assetId);
            if (schedules.length > 0) {
                return next(new UserAssetsError(`Cannot delete this logo asset. This logo has been associated with ${schedules.length} schedule(s)`, 400));
            }

            let assetRemoved = false;
            const assetPath = teamAsset.path;

            for (let tries = 0; tries < 4; tries++) {
                try {
                    logInfo('trying to delete asset %s from bucket', assetPath);
                    //await assetsBucket.file(assetPath).delete();
                    await assetsToBucket.deleteAssetFromBucket({ filePath: assetPath })
                    await UserAssetsService.deleteUserAssetByTeamId(deleteAssetContext);
                    assetRemoved = true;
                    break;
                } catch (error) {
                    if (error && error.code && error.code === 404) {
                        await UserAssetsService.deleteUserAssetByTeamId(deleteAssetContext);
                        assetRemoved = true;
                        break;
                    } else logError('failed to delete asset - retrying delete - attempt %d', tries, error);
                }
            }

            if (!assetRemoved) {
                logError('could not remove asset %s', assetPath);
                return next(new UserAssetsError('Unable to remove asset - please contact OneStream Customer Support', 400));
            }

            // return response
            return res.status(200).json({
                success: true,
                message: 'Team logo asset has been removed successfully!'
            });

        } catch (error) {
            next(error);
        }
    },

    // delete account
    handleDeleteAssets: async (req, res, next) => {

        logInfo('handling delete all assets by user %d', req.decoded._id);
        try {
            const userAccountId = req.decoded._id;
            const teamId = req.query.team_id;

            if (teamId) {
                logInfo('delete assets requested for team - moving to next handler');
                return next();
            }

            return res.status(204).json('handled assets delete');
        } catch (error) {
            next(error);
        }
    },

    // change email handling
    handleDeleteTeamAssets: async (req, res, next) => {
        logInfo('handling team %d assets delete by user %d', req.query.team_id, req.decoded._id);
        try {
            const userAccountId = req.decoded._id;
            const teamId = req.query.team_id;

            return res.status(200).json('handled delete team asets request');
        } catch (error) {
            next(error);
        }
    },


    createTemplateAssests: async (req, res, next) => {
        try {
            logInfo('handling create template assests for user %d', req.decoded._id);
            const userAccountId = req.decoded._id;
            const buffer = req.file.buffer;
            const fieldName = req.file.fieldname;
            const assetName = req.body.asset_name;
            const assetType = req.body.asset_type;
            const oldImageUrl = req.body.oldImageUrl;
            const templateId = req.body.templateId; //update case.
            const usePng = req.query.png;
            const extension = path.extname(req.file.originalname);

            //fetch template 
            let template = await TemplatesService.getTemplateByUUID(templateId)
            if (!template || !template.dataValues || !template.dataValues.uuid) {
                res.status(400).json({
                    success: false,
                    error: "Template Not Exists!"
                })
            }
            if (assetType === 'embed_player_background') {
                oldImageUrl = template.dataValues.data.details.image;
            }
            if (assetType === 'embed_player_logo') {
                oldImageUrl = template.dataValues.data.details.logo;
            }

            //delete old and create new image to bucket.
            await deleteAssetFromBucket({ oldImageUrl })
            let toUploadAssetName = getUploadAssetName({ userAccountId, fieldName, assetType, usePng, extension })
            let assetURL = `${cdnAssetsBasePath}${toUploadAssetName}`;
            let outputBuffer = await getImageBuffer({ usePng, buffer })
            let bucketResponse = await saveAssestToBucket({ toUploadAssetName, extension, outputBuffer })
            logInfo('saveAssestToBucket:', bucketResponse);

            res.status(400).json({
                success: true,
                data: {
                    url: assetURL,
                    assetType
                }
            })

        } catch (error) {
            logError('createTemplateAssests Error: ', error);
            res.status(400).json({
                success: false,
                error: "Image Not Updated!"
            })
        }
    },

    updateAsset: async (req, res, next) => {
        try {

            logInfo("updateAsset request came..")
            req.query.isUpdateDelete = true
            let deleteResponse = await UserAssetsController.handleDeleteAsset(req, res, next)
            logInfo(deleteResponse)
            if (deleteResponse) {
                logInfo("Request sent to create assets")
                await UserAssetsController.handleAssetUpload(req, res, next)
            }

        } catch (error) {
            next(error);
        }

    },
};

function getImagePath({ imageUrl, userAccountId }) {
    let indexOfPath = imageUrl.indexOf('/' + userAccountId)
    if (indexOfPath !== -1) {
        return imageUrl.substr(indexOfPath + 1);
    }
    return ''

}

async function deleteAssetFromBucket({ oldImageUrl, userAccountId }) {
    try {
        let assetPath = getImagePath({ imageUrl: oldImageUrl, userAccountId })
        if (assetPath) {
            //await assetsBucket.file(assetPath).delete();
            await assetsToBucket.deleteAssetFromBucket({ filePath: assetPath })
        }
    } catch (error) {
        logError('deleting assest error from bucket: ', error);
    }


}

async function saveAssestToBucket({ toUploadAssetName, extension, outputBuffer }) {

    await assetsToBucket.save({ toUploadAssetName, extension, outputBuffer })
}

async function getImageBuffer({ usePng, buffer }) {
    let outputBuffer = null;
    if (usePng) {
        try {
            outputBuffer = await sharp(buffer).png().toBuffer();
        } catch (error) {
            logError('error while converting image buffer to png', error);
        }
    }

    if (!outputBuffer)
        outputBuffer = buffer;

    return outputBuffer
}

function getUploadAssetName({ keyId, fieldName, assetType, usePng, extension }) {
    const toUploadAssetName = `${keyId}/${Utils.generateRandomImageName(fieldName + '-' + assetType, keyId, usePng ? '.png' : extension)}`;

    return toUploadAssetName;
}

module.exports = UserAssetsController;
