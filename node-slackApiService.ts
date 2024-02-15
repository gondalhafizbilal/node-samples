import config from 'config';
import { retryPolicies, WebClient } from '@slack/web-api';
import { OauthAccessResponse } from '@slack/web-api/dist/response/OauthAccessResponse';
import { Channel } from '@slack/web-api/dist/response/ConversationsListResponse';
import { Member } from '@slack/web-api/dist/response/UsersListResponse';
import { AuthTestResponse } from '@slack/web-api/dist/response/AuthTestResponse';
import { ClickUpError } from '../../../../utils/errors';
import { metricsClient } from '../../../../metrics/metricsClient';
import { MetricNames } from '../../metricNames';
import slackConfig from '../config';

export const SlackIntegrationError = ClickUpError.makeNamedError('slack-integration');

const API_LIMIT = 1000;
const MAX_REQUEST_CONCURRENCY = 10;

const webClient = new WebClient('', {
    retryConfig: retryPolicies.fiveRetriesInFiveMinutes,
    maxRequestConcurrency: MAX_REQUEST_CONCURRENCY,
});

export async function getApiConversationsList(token: string): Promise<Channel[]> {
    let result: Channel[] = [];
    for await (const { channels } of webClient.paginate('users.conversations', {
        token,
        exclude_archived: 'true',
        types: 'public_channel,private_channel',
        limit: API_LIMIT,
    })) {
        metricsClient.increment(MetricNames.INTEGRATIONS_SLACK_API_USERS_CONVERSATIONS);
        result = result.concat(channels);
    }

    return result;
}

export async function getApiConversationsAndGroupsList(token: string): Promise<Channel[]> {
    let result: Channel[] = [];
    try {
        for await (const { channels } of webClient.paginate('users.conversations', {
            token,
            exclude_archived: 'true',
            types: 'public_channel,private_channel,mpim,im',
            limit: API_LIMIT,
        })) {
            metricsClient.increment(MetricNames.INTEGRATIONS_SLACK_API_USERS_CONVERSATIONS);
            result = result.concat(channels);
        }
    } catch (e) {
        return getApiConversationsList(token);
    }

    return result;
}

export async function getApiUsersList(token: string): Promise<Member[]> {
    let result: Member[] = [];
    for await (const { members } of webClient.paginate('users.list', {
        token,
        limit: API_LIMIT,
    })) {
        metricsClient.increment(MetricNames.INTEGRATIONS_SLACK_API_USERS_LIST);
        result = result.concat(members);
    }

    return result;
}

export async function testSlackAuthToken(token: string): Promise<AuthTestResponse> {
    try {
        metricsClient.increment(MetricNames.INTEGRATIONS_SLACK_API_TEST);
        return await webClient.auth.test({ token });
    } catch (e) {
        throw new SlackIntegrationError(e, 'SLACKI_028');
    }
}

export async function slackOauthAccess(code: string, redirectUrl: string): Promise<OauthAccessResponse> {
    try {
        metricsClient.increment(MetricNames.INTEGRATIONS_SLACK_API_OAUTH_ACCESS);
        return await webClient.oauth.access({
            client_id: slackConfig.CLIENT_ID,
            client_secret: slackConfig.CLIENT_SECRET,
            redirect_uri: redirectUrl,
            code,
        });
    } catch (e) {
        throw new SlackIntegrationError('Failed to get slack auth token', 'SLACKI_001');
    }
}
