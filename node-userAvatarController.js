'use strict';
const path   = require('path');
const lodash = require('lodash');
const config = require('@project/config');

// errors and error codes
const {
    AvatarUploadError
} = require('../../common/errors');

// utils
const {
    Utils, 
    Debug
} = require('@project/utils');

// configs
const settings = config.config;

const cdnAvatarsBasePath = settings.storage.cdn.avatars.path;

const {
    logInfo,
    logError
} = Debug('app:controller:v2:avatar');

const {
    UserAccountService
} = require('../../services/dal');

const AvatarController = {
    /**
     * @api {post} /storage/uploads/avatar Upload User Avatar
     * @apiVersion 2.0.0
     * @apiName   Upload User Avatar
     * @apiGroup  User-Avatar
     * 
     * @apiHeader {String} x-access-token The user's jwt token that is acquired when the user logs in.
     * @apiHeader {String} Origin Use http://localhost:3000.
     * 
     * @apiParam (Form Data)    {File}    file          Avatar File    
     * 
     * @apiSuccess {Object}  avatar     Avatar
     *      
     * @apiSuccessExample {json} Success-Example
     * HTTP/1.1 200 OK
     * {       
     *      "avatar":{,..},
     * }
     * @apiErrorExample {json} Failure-Example
     * HTTP/1.1 422 Bad Request
     * {
     *    "error": "Failed to set avatar - Please try again"
     * }
     * 
     * HTTP/1.1 400 Bad Request
     * {
     *    "error": "File is not sent"
     * }
     * 
    */
    handleAvatarUploadRequest: async (req, res, next) => {
        try {
            logInfo('handling avatar multipart request', req.file);
            if (lodash.isUndefined(req.file) || lodash.isNull(req.file)) {
                return next(new AvatarUploadError('File is not sent', 400));
            }
            const userAccountId = req.decoded._id;
            const buffer        = req.file.buffer;
            const fieldName     = req.file.fieldname;
            const extension     = path.extname(req.file.originalname);
            const newAvatar     = Utils.generateRandomImageName(fieldName, userAccountId, extension);

            let userProfile = await UserAccountService.getUserProfile({userAccountId});

            if (userProfile) {
                const avatarUrl = `${cdnAvatarsBasePath}${userAccountId}/${newAvatar}`;
                logInfo('new avatar URL %s', avatarUrl);
                if (userProfile.avatar) {
                    const avatar = userProfile.avatar;
                    logInfo('old avatar is %s', avatar);
                    if (avatar) {
                        try {
                            // delete the old file
                            logInfo('deleting old avatar %s', avatar);
                            await Utils.deleteAvatarFile(avatar);
                        } catch (error) {
                            logError('error while deleting avatar', error);
                            if (error.code === 404) {
                                logError('updating user profile to set avatar as null');
                                await UserAccountService.updateUserProfile({ userAccountId, avatar: null });
                            }
                        }
                    }
                }

                // destination path - userid/filename
                const destinationPath = `${userAccountId}/${newAvatar}`;

                const options = {
                    gzip: true,
                    predefinedAcl: "publicRead",
                    private: false,
                    public: true,
                    resumable: true,
                    validation: "md5",
                    metadata: {
                        contentType: 'image/' + extension.replace('.')[1]
                    }
                }

                for (let tries = 0; tries < 4; tries ++) {
                    try {
                        logInfo('trying to upload new avatar %s from buffer', destinationPath);
                        await Utils.uploadAvatarFileUsingBuffer(destinationPath, options, buffer);
                        userProfile = await UserAccountService.updateUserProfile({userAccountId, avatar: avatarUrl});
                        break;
                    } catch (error) {
                        logError('failed to set avatar - retrying upload - attempt %d', tries, error);
                    }
                }

                if (userProfile.avatar !== avatarUrl) {
                    return next(new AvatarUploadError('Failed to set avatar - Please try again', 422));
                }
            }

            // send response
            return res.status(200).json({ avatar: userProfile.avatar });
        } catch (error) {
            logError(error);
            next(error);
        }
    }
};

module.exports = AvatarController;
