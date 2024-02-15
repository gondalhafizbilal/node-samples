const config = require('config');
const request = require('request');
const db = require('../../../../utils/db.js');
const { ClickUpError } = require('../../../../utils/errors');
const environment = require('../../../../utils/environment');

const LocalError = ClickUpError.makeNamedError('gitlabUtils');

const updateAuthToken = async (userid, team_id, refreshed_auth) => {
    const expires_at = refreshed_auth?.expires_in ? new Date().getTime() + refreshed_auth.expires_in * 1000 : null;
    try {
        const result = await db.promiseWriteQuery(
            `
              UPDATE 
                  task_mgmt.user_gitlab_teams
              SET 
                  gitlab_access_token = $3,
                  gitlab_refresh_token = $4,
                  expires_at = $5
              WHERE 
                  userid = $1 AND team_id = $2
              RETURNING 
                  userid, team_id, gitlab_access_token, host_url, self_hosted
          `,
            [userid, team_id, refreshed_auth.access_token, refreshed_auth.refresh_token, expires_at]
        );

        const updated_auth = Object.assign({}, result.rows[0]);
        return updated_auth;
    } catch (err) {
        throw new LocalError(err, 'GLA_014');
    }
};
exports.updateAuthToken = updateAuthToken;

const refreshAuthToken = async refresh_token => {
    const body = {
        client_id: config.gitlab.client_id,
        client_secret: config.gitlab.client_secret,
        refresh_token,
        grant_type: 'refresh_token',
    };

    const req_opts = {
        method: 'POST',
        uri: `https://gitlab.com/oauth/token`,
        body,
        json: true,
    };

    try {
        const auth_body = (await requestPromise(req_opts)).body;
        if (!auth_body.access_token || !auth_body.refresh_token) {
            throw new LocalError('Failed to get gitlab refresh token', 'GLA_012');
        }
        return auth_body;
    } catch (err) {
        throw new LocalError(JSON.stringify(err), 'GLA_013');
    }
};
exports.refreshAuthToken = refreshAuthToken;

const requestPromise = req_opts => {
    const promise = new Promise((resolve, reject) => {
        request(req_opts, (err, response) => {
            if (err) {
                reject(err);
            } else if (!String(response.statusCode).startsWith('2')) {
                let message = response.body ? response.body.message || response.body.error : response;
                if (Array.isArray(message)) {
                    [message] = message;
                }
                reject({ message, status: response.statusCode, body_errors: response.body });
            } else {
                resolve(response);
            }
        });
    });
    return promise;
};
exports.requestPromise = requestPromise;

const getWebhookUrl = () => {
    let hook_url;
    if (environment.isProdUS) {
        hook_url = 'https://api.clickup.com/v1/gitlab/webhookEvent';
    } else if (environment.isQA) {
        hook_url = 'https://app.clickup-qa.com/v1/gitlab/webhookEvent';
    } else if (environment.isProdEU) {
        hook_url = 'https://api.clickup-eu.com/v1/gitlab/webhookEvent';
    } else if (environment.isStagingEU) {
        hook_url = 'https://api.clickup-eudev.com/v1/gitlab/webhookEvent';
    } else {
        hook_url = 'https://dev-api.clickup.com/v1/gitlab/webhookEvent';
    }
    return hook_url;
};
exports.getWebhookUrl = getWebhookUrl;
